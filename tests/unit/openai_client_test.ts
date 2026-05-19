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
  OPENAI_PRICING_USD_PER_1M_TOKENS,
  OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_TIER_DEFAULT_MODEL,
  OpenAIApiError,
  OpenAIClient,
  OpenAIIncompleteCompletionError,
  OpenAIPricingUnknownError,
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
    // Tier 0/1 require explicit `model` (round 3 P1) — pass a
    // placeholder so the cap default behavior is still exercised.
    const tierCases: Array<{ tier: 0 | 1 | 2 | 3; model?: string }> = [
      { tier: 0, model: "gpt-5.5-pro-extended-thinking" },
      { tier: 1, model: "gpt-5.5-pro" },
      { tier: 2 },
      { tier: 3 },
    ];
    for (const tc of tierCases) {
      const { fetch, calls } = makeFetchMock(200, STANDARD_OPENAI_RESPONSE);
      const client = new OpenAIClient({
        apiKey: "sk",
        tier: tc.tier,
        fetch,
        ...(tc.model ? { model: tc.model } : {}),
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

  it("pricing table contains all 4 default tier models (DEC-010 routing)", () => {
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.5-pro-extended-thinking"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5.5-pro"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-mini"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-nano"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------
// PR #100 codex round 2 — DEC-010 Tier 0/1 routing
// ---------------------------------------------------------------------

describe("OpenAIClient — Tier 0/1 default routing (PR #100 P2)", () => {
  it("Tier 0 default = gpt-5.5-pro-extended-thinking placeholder (DEC-010 routing)", () => {
    expect(OPENAI_TIER_DEFAULT_MODEL[0]).toBe("gpt-5.5-pro-extended-thinking");
    // Construction with explicit override (round 3 P1 — Tier 0
    // requires explicit `model` because default placeholder is not
    // a callable Chat Completions ID).
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 0,
      model: "gpt-5.5-pro-extended-thinking",
    });
    expect(client.model).toBe("gpt-5.5-pro-extended-thinking");
  });

  it("Tier 1 default = gpt-5.5-pro placeholder (DEC-010 routing)", () => {
    expect(OPENAI_TIER_DEFAULT_MODEL[1]).toBe("gpt-5.5-pro");
    const client = new OpenAIClient({
      apiKey: "sk",
      tier: 1,
      model: "gpt-5.5-pro",
    });
    expect(client.model).toBe("gpt-5.5-pro");
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
  it("exact alias hit returns the alias", () => {
    expect(resolveOpenAIPricingKey("gpt-5-mini")).toBe("gpt-5-mini");
    expect(resolveOpenAIPricingKey("gpt-5")).toBe("gpt-5");
    expect(resolveOpenAIPricingKey("gpt-5-nano")).toBe("gpt-5-nano");
    expect(resolveOpenAIPricingKey("gpt-5.5-pro")).toBe("gpt-5.5-pro");
    expect(resolveOpenAIPricingKey("gpt-5.5-pro-extended-thinking")).toBe(
      "gpt-5.5-pro-extended-thinking",
    );
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

  it("dated snapshot for gpt-5.5-pro-extended-thinking does not collapse to gpt-5.5-pro", () => {
    expect(
      resolveOpenAIPricingKey("gpt-5.5-pro-extended-thinking-2026-01-01"),
    ).toBe("gpt-5.5-pro-extended-thinking");
  });

  it("dated snapshot for gpt-5.5-pro resolves to gpt-5.5-pro", () => {
    expect(resolveOpenAIPricingKey("gpt-5.5-pro-2026-01-01")).toBe("gpt-5.5-pro");
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

  it("Tier 0 (gpt-5.5-pro-extended-thinking) prices at premium rate", () => {
    const t0 = computeTotalCostUsd("gpt-5.5-pro-extended-thinking", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const t2 = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(t0).toBeGreaterThan(t2);
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
