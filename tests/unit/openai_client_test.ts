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
  OPENAI_TIER_DEFAULT_MODEL,
  OpenAIApiError,
  OpenAIClient,
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

  it("Tier override picks per-tier default model", () => {
    expect(new OpenAIClient({ apiKey: "sk", tier: 1 }).model).toBe(
      OPENAI_TIER_DEFAULT_MODEL[1],
    );
    expect(new OpenAIClient({ apiKey: "sk", tier: 3 }).model).toBe(
      OPENAI_TIER_DEFAULT_MODEL[3],
    );
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
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("body includes max_completion_tokens when maxOutputTokens passed", async () => {
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

  it("handles response with empty choices safely (no NPE)", async () => {
    const { fetch } = makeFetchMock(200, { choices: [], usage: {} });
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

  it("unknown model falls back to gpt-5-mini pricing (fail-closed)", () => {
    const known = computeTotalCostUsd("gpt-5-mini", {
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    const unknown = computeTotalCostUsd("future-model-xyz", {
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(unknown).toBe(known);
  });

  it("pricing table contains all 3 default tier models", () => {
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-mini"]).toBeDefined();
    expect(OPENAI_PRICING_USD_PER_1M_TOKENS["gpt-5-nano"]).toBeDefined();
  });
});
