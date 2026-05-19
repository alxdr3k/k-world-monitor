/**
 * Unit tests for OpenAIClient (EXTR-1A.2b).
 *
 * All HTTP calls are mocked via the injectable `fetch` option — no
 * real OpenAI API call from tests. Covers:
 *   - constructor API key fail-fast
 *   - default Tier 2 model + override
 *   - LlmClient interface compliance (vendor + tier + model readonly)
 *   - invoke() request shape (URL, headers, body)
 *   - invoke() response parsing (text + token counts + cached + cost)
 *   - error path (non-200 response → OpenAIApiError)
 *   - computeTotalCostUsd pricing math
 */

import { describe, it, expect } from "bun:test";

import {
  computeTotalCostUsd,
  isResponsesApiOnlyModel,
  OPENAI_PRICING_USD_PER_1M_TOKENS,
  OPENAI_RESPONSES_API_ONLY_MODELS,
  OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_TIER_DEFAULT_MODEL,
  OpenAIApiError,
  OpenAIClient,
  OpenAIIncompleteCompletionError,
  OpenAIPricingUnknownError,
  OpenAIRequestTimeoutError,
  OpenAIResponsesApiOnlyError,
  resolveOpenAIPricingKey,
} from "../../src/extraction/llm/openai-client";
import type { LlmClient } from "../../src/extraction/llm/client";

// ---------------------------------------------------------------------
// Fetch mocks
// ---------------------------------------------------------------------

interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

function makeFetchMock(
  status: number,
  body: unknown,
): { fetch: typeof globalThis.fetch; calls: MockFetchCall[] } {
  const calls: MockFetchCall[] = [];
  const fetchFn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(url), init });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fetchFn as unknown as typeof globalThis.fetch, calls };
}

const STANDARD_OPENAI_RESPONSE = {
  choices: [{ message: { content: "extracted body content" } }],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 250,
    prompt_tokens_details: { cached_tokens: 200 },
  },
};

// ---------------------------------------------------------------------
// Constructor / config
// ---------------------------------------------------------------------

describe("OpenAIClient — constructor + config", () => {
  it("fail-fast throws if apiKey missing and OPENAI_API_KEY env unset", () => {
    const orig = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    try {
      expect(() => new OpenAIClient()).toThrow(/apiKey required/);
    } finally {
      if (orig !== undefined) process.env["OPENAI_API_KEY"] = orig;
    }
  });

  it("fail-fast throws if apiKey is empty string", () => {
    expect(() => new OpenAIClient({ apiKey: "" })).toThrow(/apiKey required/);
    expect(() => new OpenAIClient({ apiKey: "   " })).toThrow(/apiKey required/);
  });

  it("falls back to OPENAI_API_KEY env var when apiKey omitted", () => {
    const orig = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-env-test";
    try {
      const client = new OpenAIClient();
      expect(client).toBeInstanceOf(OpenAIClient);
    } finally {
      if (orig !== undefined) {
        process.env["OPENAI_API_KEY"] = orig;
      } else {
        delete process.env["OPENAI_API_KEY"];
      }
    }
  });

  it("declares vendor='openai' (LlmClient interface)", () => {
    const client = new OpenAIClient({ apiKey: "sk-test" });
    expect(client.vendor).toBe("openai");
  });

  it("defaults to Tier 2 with model='gpt-5-mini' (ADR-0023 §statement)", () => {
    const client = new OpenAIClient({ apiKey: "sk-test" });
    expect(client.tier).toBe(2);
    expect(client.model).toBe("gpt-5-mini");
    expect(client.model).toBe(OPENAI_TIER_DEFAULT_MODEL[2]);
  });

  it("Tier override picks per-tier default model (Tier 2/3 callable; Tier 0/1 placeholder asserted via constant)", () => {
    // Tier 2/3 defaults are callable Chat Completions IDs.
    expect(new OpenAIClient({ apiKey: "sk", tier: 3 }).model).toBe(
      OPENAI_TIER_DEFAULT_MODEL[3],
    );
    expect(new OpenAIClient({ apiKey: "sk", tier: 2 }).model).toBe(
      OPENAI_TIER_DEFAULT_MODEL[2],
    );
    // Tier 0/1 defaults are placeholders that require explicit
    // `model` at construction — covered by the dedicated Tier 0/1
    // routing describe block.
    expect(OPENAI_TIER_DEFAULT_MODEL[1]).toBe("gpt-5.5-pro");
  });

  it("explicit model override wins over tier default", () => {
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      model: "gpt-5-mini-2025-08-07",
    });
    expect(client.model).toBe("gpt-5-mini-2025-08-07");
  });

  it("conforms to LlmClient interface (vendor + tier + model + invoke)", () => {
    // Structural compile-time check (no @ts-expect-error).
    const client: LlmClient = new OpenAIClient({ apiKey: "sk-test" });
    expect(client.vendor).toBe("openai");
    expect(typeof client.invoke).toBe("function");
  });
});

// ---------------------------------------------------------------------
// invoke() — request shape
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — request shape", () => {
  it("POSTs to {baseUrl}/chat/completions with Bearer auth", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({
      apiKey: "sk-test-key",
      fetch,
    });
    await client.invoke({
      systemPrompt: "sys",
      userPrompt: "<untrusted>body</untrusted>",
      tier: 2,
    });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("baseUrl override redirects fetch (for local mock servers)", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({
      apiKey: "sk",
      fetch,
      baseUrl: "http://localhost:9999/mock-openai",
    });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(calls[0]!.url).toBe(
      "http://localhost:9999/mock-openai/chat/completions",
    );
  });

  it("body includes model + system + user messages", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      fetch,
    });
    await client.invoke({
      systemPrompt: "INV-0029-1 warning",
      userPrompt: "<untrusted>article body</untrusted>",
      tier: 2,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_completion_tokens?: number;
    };
    expect(body.model).toBe("gpt-5-mini");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "INV-0029-1 warning",
    });
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "<untrusted>article body</untrusted>",
    });
  });

  it("explicit maxOutputTokens wins over per-tier default", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
      maxOutputTokens: 1234,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      max_completion_tokens?: number;
    };
    expect(body.max_completion_tokens).toBe(1234);
  });

  it("applies per-tier default max_completion_tokens when caller omits maxOutputTokens (PR #100 P2)", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", tier: 2, fetch });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      max_completion_tokens?: number;
    };
    expect(body.max_completion_tokens).toBe(
      OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[2],
    );
  });

  it("per-tier default max_completion_tokens varies by tier", async () => {
    // PR #100 codex round 6 — Tier 0/1 default placeholders are
    // responses-API-only and can no longer be constructed. Only
    // exercise Tier 2/3 here; Tier 0/1 cap values are still
    // asserted via the constant.
    expect(OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[0]).toBeGreaterThan(0);
    expect(OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[1]).toBeGreaterThan(0);
    const tierCases: Array<{ tier: 2 | 3 }> = [{ tier: 2 }, { tier: 3 }];
    for (const tc of tierCases) {
      const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
      const client = new OpenAIClient({
        apiKey: "sk",
        tier: tc.tier,
        fetch,
      });
      await client.invoke({
        systemPrompt: "s",
        userPrompt: "u",
        tier: tc.tier,
      });
      const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
        max_completion_tokens?: number;
      };
      expect(body.max_completion_tokens).toBe(
        OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[tc.tier],
      );
    }
  });
});

// ---------------------------------------------------------------------
// invoke() — response parsing
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — response parsing", () => {
  it("returns text + token counts + cached tokens + computed cost", async () => {
    const { fetch } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      fetch,
    });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("extracted body content");
    expect(result.vendor).toBe("openai");
    expect(result.model).toBe("gpt-5-mini");
    expect(result.tier).toBe(2);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(250);
    expect(result.cachedTokens).toBe(200);
    expect(result.totalCostUsd).toBeGreaterThan(0);
  });

  it("handles response with no cached_tokens field", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.cachedTokens).toBeUndefined();
  });

  // Empty `choices` is malformed per PR #100 round 3 P2 — see the
  // dedicated rejection describe below. No "returns empty string"
  // fallback any more.

  it("prefers response.model resolved snapshot over request-time alias (PR #100 P2)", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "gpt-5-mini-2025-08-07",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      model: "gpt-5-mini",
      fetch,
    });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.model).toBe("gpt-5-mini-2025-08-07");
  });

  it("falls back to request-time alias if response.model is missing/blank", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      model: "gpt-5-mini",
      fetch,
    });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.model).toBe("gpt-5-mini");
  });
});

// ---------------------------------------------------------------------
// invoke() — error paths
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — error paths", () => {
  it("throws OpenAIApiError on 4xx with body text", async () => {
    const { fetch } = makeFetchMock(400, { error: "bad request" });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIApiError);
  });

  it("OpenAIApiError carries status + responseBody", async () => {
    const { fetch } = makeFetchMock(429, "rate limited");
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIApiError);
      expect((err as OpenAIApiError).status).toBe(429);
      expect((err as OpenAIApiError).responseBody).toContain("rate limited");
      return;
    }
    throw new Error("expected OpenAIApiError");
  });

  it("propagates fetch network error", async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new TypeError("network failure");
    };
    const client = new OpenAIClient({
      apiKey: "sk",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(/network failure/);
  });
});

// ---------------------------------------------------------------------
// computeTotalCostUsd pricing
// ---------------------------------------------------------------------

describe("computeTotalCostUsd — pricing math", () => {
  it("zero tokens → zero cost", () => {
    expect(computeTotalCostUsd("gpt-5-mini", {})).toBe(0);
  });

  it("Tier 2 (gpt-5-mini) cost = (input - cached) * 0.25/1M + cached * 0.025/1M + output * 2.0/1M", () => {
    const cost = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedTokens: 0,
    });
    expect(cost).toBeCloseTo(0.25 + 2.0, 5);
  });

  it("cached input billed at discount", () => {
    const cost = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000, // all input is cached
      outputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.025, 5);
  });

  it("unknown model throws OpenAIPricingUnknownError (PR #100 round 4 F10 — silent fallback removed)", () => {
    expect(() =>
      computeTotalCostUsd("future-model-xyz", {
        inputTokens: 100_000,
        outputTokens: 100_000,
      }),
    ).toThrow(OpenAIPricingUnknownError);
  });

  it("pricing table contains Chat-Completions defaults + verified pro SKUs (Cycle 42 ratification)", () => {
    // Cycle 42 follow-up: verified OpenAI catalog pricing for pro
    // SKUs added (codex F22 citation). Pro entries are kept here
    // so a future Responses API client can price them; the current
    // /chat/completions client still rejects them at construction
    // via OPENAI_RESPONSES_API_ONLY_MODELS.
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-mini"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-nano"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-pro"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.2-pro"]).toBeDefined();
    // gpt-5.5-pro placeholders remain absent (operator-pending
    // ratification per ADR-0023 INV-0023-3).
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.5-pro"]).toBeUndefined();
  });

  it("pro SKU pricing matches documented OpenAI rates with no cached discount (codex F22 + PR #101 F31)", () => {
    // gpt-5-pro: $15.0 input / $120.0 output per 1M tokens. OpenAI
    // docs list cached input as "-" (no discount) — cachedInput
    // intentionally omitted so computeTotalCostUsd falls back to
    // the standard input rate for cached tokens.
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-pro"]!.input).toBe(15.0);
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-pro"]!.output).toBe(120.0);
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-pro"]!.cachedInput).toBeUndefined();
    // gpt-5.2-pro: $21.0 input / $168.0 output per 1M tokens.
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.2-pro"]!.input).toBe(21.0);
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.2-pro"]!.output).toBe(168.0);
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.2-pro"]!.cachedInput).toBeUndefined();
  });

  it("pro tier cached tokens bill at standard input rate (no discount, PR #101 F31)", () => {
    // Confirm the fall-back path: 1M cached tokens for gpt-5-pro
    // costs the same as 1M non-cached input tokens, not a
    // discounted 10%-style rate.
    const allCached = computeTotalCostUsd("gpt-5-pro", {
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000,
    });
    const nonCached = computeTotalCostUsd("gpt-5-pro", {
      inputTokens: 1_000_000,
      cachedTokens: 0,
    });
    expect(allCached).toBeCloseTo(nonCached, 6);
    expect(allCached).toBeCloseTo(15.0, 6);
  });

  it("Responses-API-only set drops bogus extended-thinking SKU (Cycle 42 ratification)", () => {
    // Extended thinking is an effort parameter (reasoning_effort),
    // not a separate SKU. The previous OPENAI_RESPONSES_API_ONLY_MODELS
    // entry `gpt-5-pro-extended-thinking` was incorrect and is now
    // dropped. The placeholder gpt-5.5-* entries remain because
    // they match data/llm_routing.yaml pending operator
    // ratification.
    expect(
      OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5-pro-extended-thinking"),
    ).toBe(false);
    expect(OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5-pro")).toBe(true);
    expect(OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5.2-pro")).toBe(true);
    expect(OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5.5-pro")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 2 — DEC-010 Tier 0/1 routing
// ---------------------------------------------------------------------

describe("OpenAIClient — Tier 0/1 default routing (PR #100 P2)", () => {
  it("Tier 0 default = gpt-5.5-pro-extended-thinking placeholder (DEC-010 routing)", () => {
    expect(OPENAI_TIER_DEFAULT_MODEL[0]).toBe("gpt-5.5-pro-extended-thinking");
    // PR #100 codex round 6 — passing this placeholder ID now
    // rejects at construction (responses-API-only set). Tier 0
    // callers must wait for the Responses API client.
  });

  it("Tier 1 default = gpt-5.5-pro placeholder (DEC-010 routing)", () => {
    expect(OPENAI_TIER_DEFAULT_MODEL[1]).toBe("gpt-5.5-pro");
    // Same as above — placeholder + responses-API-only reject.
  });

  it("Tier 0 and Tier 1 placeholders are DIFFERENT (no collapse to gpt-5)", () => {
    expect(OPENAI_TIER_DEFAULT_MODEL[0]).not.toBe(OPENAI_TIER_DEFAULT_MODEL[1]);
    expect(OPENAI_TIER_DEFAULT_MODEL[0]).not.toBe("gpt-5");
    expect(OPENAI_TIER_DEFAULT_MODEL[1]).not.toBe("gpt-5");
  });

  it("Tier 0 constructor REQUIRES explicit model option (PR #100 round 3 P1)", () => {
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 0 })).toThrow(
      /tier=0.*requires an explicit `model` option/,
    );
  });

  it("Tier 1 constructor REQUIRES explicit model option (PR #100 round 3 P1)", () => {
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 1 })).toThrow(
      /tier=1.*requires an explicit `model` option/,
    );
  });

  it("Tier 2 / Tier 3 construct without model (defaults remain callable)", () => {
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 2 })).not.toThrow();
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 3 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 6 — Responses-API-only model rejection (F20)
// ---------------------------------------------------------------------

describe("OpenAIClient — Responses-API-only model rejection (PR #100 round 6 F20)", () => {
  it("rejects gpt-5-pro at construction (Responses-API only)", () => {
    expect(
      () =>
        new OpenAIClient({ apiKey: "sk", tier: 0, model: "gpt-5-pro" }),
    ).toThrow(OpenAIResponsesApiOnlyError);
  });

  it("rejects gpt-5.2-pro at construction", () => {
    expect(
      () =>
        new OpenAIClient({ apiKey: "sk", tier: 0, model: "gpt-5.2-pro" }),
    ).toThrow(OpenAIResponsesApiOnlyError);
  });

  it("rejects gpt-5.5-pro and gpt-5.5-pro-extended-thinking", () => {
    expect(
      () =>
        new OpenAIClient({ apiKey: "sk", tier: 0, model: "gpt-5.5-pro" }),
    ).toThrow(OpenAIResponsesApiOnlyError);
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 0,
          model: "gpt-5.5-pro-extended-thinking",
        }),
    ).toThrow(OpenAIResponsesApiOnlyError);
  });

  it("known set covers documented OpenAI pro SKUs", () => {
    expect(OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5-pro")).toBe(true);
    expect(OPENAI_RESPONSES_API_ONLY_MODELS.has("gpt-5.2-pro")).toBe(true);
  });

  it("rejects dated pro snapshot via prefix (round 7 F25)", () => {
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 0,
          model: "gpt-5-pro-2026-01-01",
        }),
    ).toThrow(OpenAIResponsesApiOnlyError);
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 0,
          model: "gpt-5.2-pro-2026-01-01",
        }),
    ).toThrow(OpenAIResponsesApiOnlyError);
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 0,
          model: "gpt-5-pro-extended-thinking-2026-05-19",
        }),
    ).toThrow(OpenAIResponsesApiOnlyError);
  });

  it("isResponsesApiOnlyModel exact + prefix matching (round 7 F25)", () => {
    expect(isResponsesApiOnlyModel("gpt-5-pro")).toBe(true);
    expect(isResponsesApiOnlyModel("gpt-5-pro-2026-01-01")).toBe(true);
    expect(isResponsesApiOnlyModel("gpt-5.2-pro")).toBe(true);
    expect(isResponsesApiOnlyModel("gpt-5.5-pro-extended-thinking-2026-01-01")).toBe(true);
    // Non-pro models / dated snapshots stay false.
    expect(isResponsesApiOnlyModel("gpt-5-mini")).toBe(false);
    expect(isResponsesApiOnlyModel("gpt-5-mini-2025-08-07")).toBe(false);
    expect(isResponsesApiOnlyModel("gpt-5")).toBe(false);
    expect(isResponsesApiOnlyModel("gpt-5-2025-09-15")).toBe(false);
    expect(isResponsesApiOnlyModel("gpt-5-nano")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 6 — pre-API pricing validation (F23)
// ---------------------------------------------------------------------

describe("OpenAIClient — constructor pricing validation (PR #100 round 6 F23)", () => {
  it("rejects construction when model has no pricing entry (pre-API fail-fast)", () => {
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 2,
          model: "gpt-5.1-2026-01-01",
        }),
    ).toThrow(OpenAIPricingUnknownError);
  });

  it("accepts construction for priced default tiers (gpt-5-mini, gpt-5-nano)", () => {
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 2 })).not.toThrow();
    expect(() => new OpenAIClient({ apiKey: "sk", tier: 3 })).not.toThrow();
  });

  it("accepts dated snapshot whose alias prefix is priced", () => {
    expect(
      () =>
        new OpenAIClient({
          apiKey: "sk",
          tier: 2,
          model: "gpt-5-mini-2025-08-07",
        }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 6 — request timeout (F18)
// ---------------------------------------------------------------------

describe("OpenAIClient — request timeout (PR #100 round 6 F18)", () => {
  it("throws OpenAIRequestTimeoutError when fetch stalls past timeoutMs", async () => {
    // Fetch never resolves naturally — only the abort signal can end it.
    const stallingFetch = ((
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof globalThis.fetch;
    const client = new OpenAIClient({
      apiKey: "sk",
      fetch: stallingFetch,
      timeoutMs: 25,
    });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIRequestTimeoutError);
  });

  it("does not fire timeout when response arrives in time", async () => {
    const { fetch } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({
      apiKey: "sk",
      fetch,
      timeoutMs: 5_000,
    });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("extracted body content");
  });

  it("rejects non-positive timeoutMs at construction", () => {
    expect(
      () => new OpenAIClient({ apiKey: "sk", timeoutMs: 0 }),
    ).toThrow(/timeoutMs/);
    expect(
      () => new OpenAIClient({ apiKey: "sk", timeoutMs: -5 }),
    ).toThrow(/timeoutMs/);
    expect(
      () => new OpenAIClient({ apiKey: "sk", timeoutMs: Number.NaN }),
    ).toThrow(/timeoutMs/);
  });

  it("timeout covers the body read after headers arrive (round 7 F26)", async () => {
    // Fetch resolves with a Response whose `json()` stalls until
    // the signal aborts. This exercises the case where fetch()
    // returns quickly (headers received) but the body read hangs —
    // round 6 cleared the timer immediately after fetch resolved,
    // so the body stall was unbounded. Round 7 keeps the timer
    // alive through json().
    const slowJsonFetch = ((
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      // Construct a Response whose body promises never settle
      // until the signal aborts.
      const stallingBody = new Blob(["{"], {
        type: "application/json",
      });
      const response = new Response(stallingBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      // Override json() to stall until the controller aborts.
      Object.defineProperty(response, "json", {
        value: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      });
      return Promise.resolve(response);
    }) as unknown as typeof globalThis.fetch;
    const client = new OpenAIClient({
      apiKey: "sk",
      fetch: slowJsonFetch,
      timeoutMs: 25,
    });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIRequestTimeoutError);
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 6 — DEC-010 §8 extract controls (F19)
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — DEC-010 §8 extract controls (PR #100 round 6 F19)", () => {
  it("body includes temperature=0 by default (DEC-010 extract determinism)", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      temperature?: number;
    };
    expect(body.temperature).toBe(0);
  });

  it("respects explicit temperature override (e.g. scenario branch 0.3)", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
      temperature: 0.3,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      temperature?: number;
    };
    expect(body.temperature).toBe(0.3);
  });

  it("forwards responseFormat to body when caller supplies schema", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const schema = {
      type: "json_schema",
      json_schema: {
        name: "ArticleExtraction",
        schema: { type: "object", properties: { headline: { type: "string" } } },
        strict: true,
      },
    };
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
      responseFormat: schema,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      response_format?: unknown;
    };
    expect(body.response_format).toEqual(schema);
  });

  it("omits response_format from body when caller does not supply schema", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    const body = JSON.parse((calls[0]!.init?.body as string) ?? "{}") as {
      response_format?: unknown;
    };
    expect(body.response_format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 6 — null/malformed usage counters (F21)
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — null/malformed usage counters (PR #100 round 6 F21)", () => {
  it("treats completion_tokens=null as missing_usage (not as 0)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: null },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "missing_usage",
      );
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("treats non-integer completion_tokens as missing_usage", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50.5 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("rejects cached_tokens > prompt_tokens as usage_inconsistent (PR #100 round 8 F29)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 200 },
      },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "usage_inconsistent",
      );
      // No usage carried to avoid passing impossible accounting to
      // failRun.
      expect((err as OpenAIIncompleteCompletionError).usage).toBeUndefined();
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("accepts cached_tokens === prompt_tokens (all-cached input is valid)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.cachedTokens).toBe(100);
  });

  it("incomplete completion with null counter → error.usage is undefined (no failRun validation throw)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        { message: { content: "truncated" }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: null },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      // finish_reason check fires first (after choice/content
      // validation); the malformed completion_tokens just makes
      // `usagePresent` false so the error's usage payload is
      // undefined — failRun gets called without integer-validation
      // input that would otherwise throw and leave the ledger row
      // stuck in `running`.
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "length",
      );
      expect((err as OpenAIIncompleteCompletionError).usage).toBeUndefined();
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 3 — empty / malformed OpenAI response rejection
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — empty/malformed response rejection (PR #100 round 3 P2)", () => {
  it("throws OpenAIIncompleteCompletionError when choices is empty array", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "missing_choice",
      );
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("throws OpenAIIncompleteCompletionError when choices is missing entirely", async () => {
    const { fetch } = makeFetchMock(200, {
      usage: { prompt_tokens: 100 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("throws when first choice has no message field", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ finish_reason: "stop" }],
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "missing_content",
      );
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("throws when message.content is null", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: null }, finish_reason: "stop" }],
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("throws when message.content is an array (non-string shape) — PR #100 round 7 F27", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        {
          message: { content: [{ type: "text", text: "ok" }] },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("throws when message.content is an object (round 7 F27)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        {
          message: { content: { text: "ok" } },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("accepts content='' with finish_reason='stop' (valid empty extraction)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("");
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 4 — missing usage rejection (F12)
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — missing usage rejection (PR #100 round 4 F12)", () => {
  it("throws OpenAIIncompleteCompletionError('missing_usage') when usage block absent", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "missing_usage",
      );
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("throws when usage has neither prompt_tokens nor completion_tokens", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: {},
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("rejects usage with prompt_tokens only — completion_tokens REQUIRED (PR #100 round 5 F16)", async () => {
    // Round 5 F16 — round 4 accepted prompt-only (OR check) which
    // undercounted output cost when the response text proved
    // completion tokens were generated. Round 5 requires AND:
    // both counters must be present.
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("accepts usage with prompt_tokens=N + completion_tokens=0 (valid empty stop)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 4 — incomplete error carries billable usage (F13)
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — incomplete completions preserve billable usage (PR #100 round 4 F13)", () => {
  it("finish_reason='length' with usage → error.usage carries cost", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "gpt-5-mini-2025-08-07",
      choices: [
        { message: { content: "truncated" }, finish_reason: "length" },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 2000,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    });
    const client = new OpenAIClient({ apiKey: "sk", tier: 2, fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      const incomplete = err as OpenAIIncompleteCompletionError;
      expect(incomplete.finishReason).toBe("length");
      expect(incomplete.usage).toBeDefined();
      expect(incomplete.usage!.inputTokens).toBe(1000);
      expect(incomplete.usage!.outputTokens).toBe(2000);
      expect(incomplete.usage!.cachedTokens).toBe(100);
      expect(incomplete.usage!.totalCostUsd).toBeGreaterThan(0);
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("finish_reason='content_filter' with usage → error.usage carries cost", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        { message: { content: "" }, finish_reason: "content_filter" },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      const incomplete = err as OpenAIIncompleteCompletionError;
      expect(incomplete.usage).toBeDefined();
      expect(incomplete.usage!.totalCostUsd).toBeGreaterThan(0);
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("missing_content with no usage → error.usage is undefined (no fake zero cost)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ finish_reason: "stop" }],
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      const incomplete = err as OpenAIIncompleteCompletionError;
      expect(incomplete.finishReason).toBe("missing_content");
      expect(incomplete.usage).toBeUndefined();
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("incomplete-error usage carries resolved-model snapshot (PR #100 round 5 F15)", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "gpt-5-mini-2025-08-07",
      choices: [
        { message: { content: "truncated" }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 2,
      model: "gpt-5-mini",
      fetch,
    });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      const incomplete = err as OpenAIIncompleteCompletionError;
      expect(incomplete.usage).toBeDefined();
      expect(incomplete.usage!.modelId).toBe("gpt-5-mini-2025-08-07");
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 2 — pricing key prefix-match for dated snapshots
// ---------------------------------------------------------------------

describe("resolveOpenAIPricingKey — dated-snapshot prefix lookup (PR #100 P2)", () => {
  it("exact alias hit returns the alias (Chat-Completions defaults only after round 6 F22)", () => {
    expect(resolveOpenAIPricingKey("gpt-5-mini")).toBe("gpt-5-mini");
    expect(resolveOpenAIPricingKey("gpt-5")).toBe("gpt-5");
    expect(resolveOpenAIPricingKey("gpt-5-nano")).toBe("gpt-5-nano");
    // Pro entries dropped (F22) — resolution returns null.
    expect(resolveOpenAIPricingKey("gpt-5.5-pro")).toBeNull();
    expect(resolveOpenAIPricingKey("gpt-5.5-pro-extended-thinking")).toBeNull();
  });

  it("dated snapshot for gpt-5-mini resolves to gpt-5-mini (not gpt-5 prefix-eat)", () => {
    expect(resolveOpenAIPricingKey("gpt-5-mini-2025-08-07")).toBe("gpt-5-mini");
  });

  it("dated snapshot for gpt-5-nano resolves to gpt-5-nano", () => {
    expect(resolveOpenAIPricingKey("gpt-5-nano-2025-08-07")).toBe("gpt-5-nano");
  });

  it("dated snapshot for gpt-5 (without -mini/-nano suffix) resolves to gpt-5", () => {
    expect(resolveOpenAIPricingKey("gpt-5-2025-09-15")).toBe("gpt-5");
  });

  it("dated snapshot for dropped pro alias returns null after F22", () => {
    expect(
      resolveOpenAIPricingKey("gpt-5.5-pro-extended-thinking-2026-01-01"),
    ).toBeNull();
    expect(resolveOpenAIPricingKey("gpt-5.5-pro-2026-01-01")).toBeNull();
  });

  it("truly unknown model returns null (caller decides fallback)", () => {
    expect(resolveOpenAIPricingKey("future-model-xyz")).toBeNull();
    expect(resolveOpenAIPricingKey("claude-sonnet-4-6")).toBeNull();
  });
});

describe("computeTotalCostUsd — dated snapshot pricing (PR #100 P2)", () => {
  it("dated gpt-5-mini snapshot prices at gpt-5-mini rate (not fallback)", () => {
    const aliasCost = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const datedCost = computeTotalCostUsd("gpt-5-mini-2025-08-07", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(datedCost).toBeCloseTo(aliasCost, 6);
  });

  it("dated gpt-5 snapshot prices at gpt-5 rate (NOT eaten by gpt-5-mini fallback)", () => {
    const aliasCost = computeTotalCostUsd("gpt-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const datedCost = computeTotalCostUsd("gpt-5-2025-09-15", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(datedCost).toBeCloseTo(aliasCost, 6);
    // gpt-5 must be DIFFERENT from gpt-5-mini (round 1 P2 bug — Tier 0/1 was being undercounted).
    const miniCost = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(datedCost).not.toBeCloseTo(miniCost, 2);
  });

  it("dated gpt-5-nano snapshot prices at gpt-5-nano rate (NOT overcounted by gpt-5-mini fallback)", () => {
    const aliasCost = computeTotalCostUsd("gpt-5-nano", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const datedCost = computeTotalCostUsd("gpt-5-nano-2025-08-07", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(datedCost).toBeCloseTo(aliasCost, 6);
    const miniCost = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(datedCost).toBeLessThan(miniCost);
  });

  it("dropped pro placeholders now throw OpenAIPricingUnknownError (round 6 F22)", () => {
    expect(() =>
      computeTotalCostUsd("gpt-5.5-pro-extended-thinking", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toThrow(OpenAIPricingUnknownError);
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 2 — finish_reason rejection
// ---------------------------------------------------------------------

describe("OpenAIClient.invoke — finish_reason rejection (PR #100 P2)", () => {
  it("throws OpenAIIncompleteCompletionError when finish_reason='length' (truncated)", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "gpt-5-mini-2025-08-07",
      choices: [
        {
          message: { content: "partial output cut off" },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 2000 },
    });
    const client = new OpenAIClient({ apiKey: "sk", tier: 2, fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("throws OpenAIIncompleteCompletionError when finish_reason='content_filter'", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        {
          message: { content: "" },
          finish_reason: "content_filter",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    try {
      await client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIIncompleteCompletionError);
      expect((err as OpenAIIncompleteCompletionError).finishReason).toBe(
        "content_filter",
      );
      expect((err as OpenAIIncompleteCompletionError).partialText).toBe("");
      return;
    }
    throw new Error("expected OpenAIIncompleteCompletionError");
  });

  it("throws OpenAIIncompleteCompletionError when finish_reason='tool_calls' (unsupported at this layer)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        {
          message: { content: "" },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    await expect(
      client.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 }),
    ).rejects.toThrow(OpenAIIncompleteCompletionError);
  });

  it("accepts finish_reason='stop' (natural completion)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [
        {
          message: { content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("ok");
  });

  it("accepts response without finish_reason (defensive — older API shape)", async () => {
    const { fetch } = makeFetchMock(200, {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = new OpenAIClient({ apiKey: "sk", fetch });
    const result = await client.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(result.text).toBe("ok");
  });
});
