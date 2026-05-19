/**
 * AnthropicClient tests (EXTR-1A.2c.1).
 *
 * Mirrors `openai_client_test.ts` structure — vendor-agnostic
 * coverage of the `LlmClient` contract plus Anthropic-specific
 * wire-shape, strict-schema tool mapping, and incomplete-completion
 * handling. Real Anthropic API calls are not exercised; tests inject
 * a mock `fetch` that asserts the request shape and returns canned
 * response bodies.
 */

import { describe, it, expect } from "bun:test";

import {
  ANTHROPIC_PRICING_USD_PER_1M_TOKENS,
  ANTHROPIC_TIER_DEFAULT_MAX_OUTPUT_TOKENS,
  ANTHROPIC_TIER_DEFAULT_MODEL,
  AnthropicApiError,
  AnthropicClient,
  AnthropicIncompleteCompletionError,
  AnthropicPricingUnknownError,
  AnthropicRequestTimeoutError,
  computeAnthropicTotalCostUsd,
  resolveAnthropicPricingKey,
} from "../../src/extraction/llm/anthropic-client";
import type { LlmClient } from "../../src/extraction/llm/client";

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

const STANDARD_ANTHROPIC_TEXT_RESPONSE = {
  model: "claude-sonnet-4-6-20260101",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "extracted body content" }],
  usage: {
    input_tokens: 1000,
    output_tokens: 250,
    cache_read_input_tokens: 200,
  },
};

const SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "article_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "key_claims"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        key_claims: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "evidence_quote"],
            properties: {
              claim: { type: "string" },
              evidence_quote: { type: "string" },
            },
          },
        },
      },
    },
  },
};

const STANDARD_ANTHROPIC_TOOL_RESPONSE = {
  model: "claude-sonnet-4-6-20260101",
  stop_reason: "tool_use",
  content: [
    {
      type: "tool_use",
      id: "toolu_abc",
      name: "article_extraction",
      input: {
        title: "Sample headline",
        summary: "A short factual summary.",
        key_claims: [
          { claim: "claim one", evidence_quote: "quote one" },
        ],
      },
    },
  ],
  usage: {
    input_tokens: 800,
    output_tokens: 120,
  },
};

// ---------------------------------------------------------------------
// Constructor / config
// ---------------------------------------------------------------------

describe("AnthropicClient — constructor + config", () => {
  it("fail-fast throws if apiKey missing and ANTHROPIC_API_KEY env unset", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      expect(() => new AnthropicClient()).toThrow(/apiKey required/);
    } finally {
      if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    }
  });

  it("fail-fast throws if apiKey is empty string or whitespace", () => {
    expect(() => new AnthropicClient({ apiKey: "" })).toThrow(/apiKey required/);
    expect(() => new AnthropicClient({ apiKey: "   " })).toThrow(/apiKey required/);
  });

  it("falls back to ANTHROPIC_API_KEY env var when apiKey omitted", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-env-test";
    try {
      const client = new AnthropicClient();
      expect(client).toBeInstanceOf(AnthropicClient);
    } finally {
      if (orig !== undefined) {
        process.env["ANTHROPIC_API_KEY"] = orig;
      } else {
        delete process.env["ANTHROPIC_API_KEY"];
      }
    }
  });

  it("defaults to tier=2 + Sonnet 4.6 model when not specified", () => {
    const c = new AnthropicClient({ apiKey: "sk-ant-test" });
    expect(c.tier).toBe(2);
    expect(c.model).toBe(ANTHROPIC_TIER_DEFAULT_MODEL[2]);
    expect(c.model).toBe("claude-sonnet-4-6");
    expect(c.vendor).toBe("anthropic");
  });

  it("requires explicit `model` when tier=0 (DEC-010 placeholder Tier 0)", () => {
    expect(
      () => new AnthropicClient({ apiKey: "sk-ant-test", tier: 0 }),
    ).toThrow(/tier=0.*requires an explicit `model` option/);
  });

  it("accepts tier=0 when explicit model is provided", () => {
    const c = new AnthropicClient({
      apiKey: "sk-ant-test",
      tier: 0,
      model: "claude-opus-4-7",
    });
    expect(c.tier).toBe(0);
    expect(c.model).toBe("claude-opus-4-7");
  });

  it("tier=1 + tier=3 use defaults without explicit model", () => {
    const c1 = new AnthropicClient({ apiKey: "sk-ant-test", tier: 1 });
    expect(c1.model).toBe("claude-sonnet-4-6");
    const c3 = new AnthropicClient({ apiKey: "sk-ant-test", tier: 3 });
    expect(c3.model).toBe("claude-haiku-4-5");
  });

  it("throws AnthropicPricingUnknownError at construction for unknown SKU", () => {
    expect(
      () =>
        new AnthropicClient({
          apiKey: "sk-ant-test",
          tier: 2,
          model: "claude-mystery-9000",
        }),
    ).toThrow(AnthropicPricingUnknownError);
  });

  it("rejects non-finite or non-positive timeoutMs", () => {
    expect(
      () =>
        new AnthropicClient({ apiKey: "sk-ant-test", timeoutMs: 0 }),
    ).toThrow(/timeoutMs must be a positive finite number/);
    expect(
      () =>
        new AnthropicClient({ apiKey: "sk-ant-test", timeoutMs: -100 }),
    ).toThrow(/timeoutMs must be a positive finite number/);
    expect(
      () =>
        new AnthropicClient({ apiKey: "sk-ant-test", timeoutMs: NaN }),
    ).toThrow(/timeoutMs must be a positive finite number/);
  });
});

// ---------------------------------------------------------------------
// Invoke — request shape
// ---------------------------------------------------------------------

describe("AnthropicClient.invoke — request shape", () => {
  it("POSTs to /messages with x-api-key + anthropic-version headers", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    await c.invoke({
      systemPrompt: "sys",
      userPrompt: "<untrusted>body</untrusted>",
      tier: 2,
    });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends model + max_tokens + system + messages + temperature=0 by default", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    await c.invoke({
      systemPrompt: "sys-content",
      userPrompt: "user-content",
      tier: 2,
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("sys-content");
    expect(body.messages).toEqual([{ role: "user", content: "user-content" }]);
    expect(body.max_tokens).toBe(ANTHROPIC_TIER_DEFAULT_MAX_OUTPUT_TOKENS[2]);
    expect(body.temperature).toBe(0);
  });

  it("caller maxOutputTokens + temperature overrides defaults", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    await c.invoke({
      systemPrompt: "sys",
      userPrompt: "user",
      tier: 2,
      maxOutputTokens: 500,
      temperature: 0.3,
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
  });

  it("translates json_schema responseFormat to forced-tool contract", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TOOL_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    await c.invoke({
      systemPrompt: "sys",
      userPrompt: "user",
      tier: 2,
      responseFormat: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT,
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.tools).toEqual([
      {
        name: "article_extraction",
        input_schema: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT.json_schema.schema,
      },
    ]);
    expect(body.tool_choice).toEqual({
      type: "tool",
      name: "article_extraction",
    });
  });

  it("forwards vendor-native responseFormat unchanged (non-json_schema shape)", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    await c.invoke({
      systemPrompt: "sys",
      userPrompt: "user",
      tier: 2,
      responseFormat: { foo: "bar", nested: { x: 1 } },
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.foo).toBe("bar");
    expect(body.nested).toEqual({ x: 1 });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("custom baseUrl + anthropicVersion are honored", async () => {
    const { fetch, calls } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({
      apiKey: "sk-ant-test",
      baseUrl: "https://proxy.local/v1",
      anthropicVersion: "2099-01-01",
      fetch,
    });
    await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    expect(calls[0]!.url).toBe("https://proxy.local/v1/messages");
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2099-01-01");
  });
});

// ---------------------------------------------------------------------
// Invoke — response parsing
// ---------------------------------------------------------------------

describe("AnthropicClient.invoke — response parsing", () => {
  it("returns text + vendor + tier + token counters from text path", async () => {
    const { fetch } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    const r = await c.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
    });
    expect(r.text).toBe("extracted body content");
    expect(r.vendor).toBe("anthropic");
    expect(r.tier).toBe(2);
    expect(r.inputTokens).toBe(1000);
    expect(r.outputTokens).toBe(250);
    expect(r.cachedTokens).toBe(200);
    expect(r.totalCostUsd).toBeGreaterThan(0);
  });

  it("prefers resolved snapshot model over request-time alias", async () => {
    const { fetch } = makeFetchMock(200, STANDARD_ANTHROPIC_TEXT_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    const r = await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    expect(r.model).toBe("claude-sonnet-4-6-20260101");
  });

  it("falls back to request-time alias when response.model is blank", async () => {
    const { fetch } = makeFetchMock(200, {
      ...STANDARD_ANTHROPIC_TEXT_RESPONSE,
      model: "",
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    const r = await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("tool_use path JSON-stringifies tool input as text (matches OpenAI json_schema wire form)", async () => {
    const { fetch } = makeFetchMock(200, STANDARD_ANTHROPIC_TOOL_RESPONSE);
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    const r = await c.invoke({
      systemPrompt: "s",
      userPrompt: "u",
      tier: 2,
      responseFormat: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT,
    });
    const parsed = JSON.parse(r.text);
    expect(parsed.title).toBe("Sample headline");
    expect(parsed.key_claims[0]).toEqual({
      claim: "claim one",
      evidence_quote: "quote one",
    });
  });

  it("concatenates multiple text content blocks on free-form path", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "part one " },
        { type: "text", text: "part two" },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    const r = await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    expect(r.text).toBe("part one part two");
  });
});

// ---------------------------------------------------------------------
// Invoke — error paths
// ---------------------------------------------------------------------

describe("AnthropicClient.invoke — error paths", () => {
  it("throws AnthropicApiError on non-2xx status with body preserved", async () => {
    const { fetch } = makeFetchMock(400, { error: "bad request" });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicApiError);
    expect((caught as AnthropicApiError).status).toBe(400);
    expect((caught as AnthropicApiError).responseBody).toContain("bad request");
  });

  it("throws AnthropicRequestTimeoutError when fetch is aborted", async () => {
    const slowFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      await new Promise<void>((resolve, reject) => {
        const sig = init?.signal;
        if (sig) {
          sig.addEventListener("abort", () => reject(sig.reason ?? new DOMException("aborted", "AbortError")));
        }
        setTimeout(resolve, 5000);
      });
      return new Response("{}", { status: 200 });
    };
    const c = new AnthropicClient({
      apiKey: "sk-ant-test",
      fetch: slowFetch as unknown as typeof globalThis.fetch,
      timeoutMs: 30,
    });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicRequestTimeoutError);
    expect((caught as AnthropicRequestTimeoutError).timeoutMs).toBe(30);
  });
});

// ---------------------------------------------------------------------
// Invoke — incomplete completion / malformed response rejection
// ---------------------------------------------------------------------

describe("AnthropicClient.invoke — incomplete completion rejection", () => {
  it("throws Incomplete with stop_reason=max_tokens for truncated text", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "partial" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).stopReason).toBe(
      "max_tokens",
    );
    expect((caught as AnthropicIncompleteCompletionError).usage?.totalCostUsd).toBeGreaterThan(0);
  });

  it("throws Incomplete with missing_tool_use when forced tool absent from content", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ignored free text" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({
        systemPrompt: "s",
        userPrompt: "u",
        tier: 2,
        responseFormat: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "missing_tool_use",
    );
  });

  it("throws Incomplete with malformed_tool_input when tool_use input is not an object", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "article_extraction",
          input: "this should be an object",
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({
        systemPrompt: "s",
        userPrompt: "u",
        tier: 2,
        responseFormat: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "malformed_tool_input",
    );
  });

  it("throws Incomplete with max_tokens for truncated tool_use call", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "max_tokens",
      content: [
        {
          type: "tool_use",
          name: "article_extraction",
          input: { title: "partial" },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({
        systemPrompt: "s",
        userPrompt: "u",
        tier: 2,
        responseFormat: SAMPLE_JSON_SCHEMA_RESPONSE_FORMAT,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "max_tokens",
    );
  });

  it("throws Incomplete with missing_content when no content blocks on free-form path", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "missing_content",
    );
  });

  it("throws Incomplete with missing_content when text block has non-string text", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: null }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "missing_content",
    );
  });

  it("throws Incomplete with missing_usage when usage block omitted", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "missing_usage",
    );
  });

  it("throws Incomplete with usage_inconsistent when cached > input", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
      },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "usage_inconsistent",
    );
    expect((caught as AnthropicIncompleteCompletionError).usage).toBeUndefined();
  });

  it("rejects null/non-integer counters as missing_usage", async () => {
    const { fetch } = makeFetchMock(200, {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: null, output_tokens: 50 },
    });
    const c = new AnthropicClient({ apiKey: "sk-ant-test", fetch });
    let caught: unknown;
    try {
      await c.invoke({ systemPrompt: "s", userPrompt: "u", tier: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicIncompleteCompletionError);
    expect((caught as AnthropicIncompleteCompletionError).reason).toBe(
      "missing_usage",
    );
  });
});

// ---------------------------------------------------------------------
// computeAnthropicTotalCostUsd / pricing
// ---------------------------------------------------------------------

describe("computeAnthropicTotalCostUsd — pricing math", () => {
  it("Sonnet 4.6 standard input + output (no cache)", () => {
    // input 1M @ $3 + output 1M @ $15 = $18
    const c = computeAnthropicTotalCostUsd("claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c).toBeCloseTo(18.0, 6);
  });

  it("Sonnet 4.6 with cached input billed at 10% rate", () => {
    // input 1000 tokens, 800 cached → 200 nonCached @ $3/1M = $0.0006
    // cached 800 @ $0.3/1M = $0.00024
    // output 250 @ $15/1M = $0.00375
    // total = $0.00459
    const c = computeAnthropicTotalCostUsd("claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 250,
      cachedTokens: 800,
    });
    expect(c).toBeCloseTo(0.00459, 6);
  });

  it("Opus 4.7 pricing higher than Sonnet", () => {
    const opusCost = computeAnthropicTotalCostUsd("claude-opus-4-7", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const sonnetCost = computeAnthropicTotalCostUsd("claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(opusCost).toBeGreaterThan(sonnetCost);
  });

  it("Haiku 4.5 pricing lower than Sonnet", () => {
    const haikuCost = computeAnthropicTotalCostUsd("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const sonnetCost = computeAnthropicTotalCostUsd("claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(haikuCost).toBeLessThan(sonnetCost);
  });

  it("throws AnthropicPricingUnknownError for unknown model", () => {
    expect(() =>
      computeAnthropicTotalCostUsd("claude-mystery-9000", {
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).toThrow(AnthropicPricingUnknownError);
  });

  it("returns 0 when both token counts absent", () => {
    expect(computeAnthropicTotalCostUsd("claude-sonnet-4-6", {})).toBe(0);
  });
});

// ---------------------------------------------------------------------
// resolveAnthropicPricingKey — dated-snapshot prefix lookup
// ---------------------------------------------------------------------

describe("resolveAnthropicPricingKey — dated-snapshot prefix lookup", () => {
  it("exact match returns the alias itself", () => {
    expect(resolveAnthropicPricingKey("claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
    expect(resolveAnthropicPricingKey("claude-opus-4-7")).toBe(
      "claude-opus-4-7",
    );
  });

  it("dated snapshot maps to underlying alias via longest-prefix", () => {
    expect(resolveAnthropicPricingKey("claude-sonnet-4-6-20260101")).toBe(
      "claude-sonnet-4-6",
    );
    expect(resolveAnthropicPricingKey("claude-haiku-4-5-20251231")).toBe(
      "claude-haiku-4-5",
    );
  });

  it("returns null for unknown model", () => {
    expect(resolveAnthropicPricingKey("claude-mystery-9000")).toBeNull();
    expect(resolveAnthropicPricingKey("gpt-5-mini")).toBeNull();
  });

  it("dated snapshot for Opus does not collide with Sonnet alias", () => {
    // ensures longest-prefix sorting is correct
    expect(resolveAnthropicPricingKey("claude-opus-4-7-20260101")).toBe(
      "claude-opus-4-7",
    );
  });
});

// ---------------------------------------------------------------------
// LlmClient interface compliance
// ---------------------------------------------------------------------

describe("AnthropicClient — LlmClient interface compliance", () => {
  it("satisfies LlmClient interface (vendor + tier + model + invoke)", () => {
    const c: LlmClient = new AnthropicClient({
      apiKey: "sk-ant-test",
    });
    expect(c.vendor).toBe("anthropic");
    expect(c.tier).toBe(2);
    expect(typeof c.model).toBe("string");
    expect(typeof c.invoke).toBe("function");
  });

  it("ANTHROPIC_PRICING table covers all default tier models", () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const model = ANTHROPIC_TIER_DEFAULT_MODEL[tier];
      expect(ANTHROPIC_PRICING_USD_PER_1M_TOKENS[model]).toBeDefined();
    }
  });
});
