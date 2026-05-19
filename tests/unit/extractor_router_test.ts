/**
 * Unit tests for the extractor router (EXTR-1A.1).
 *
 * - TEST-009 (AC-009): article / dataset / report dispatch correctness.
 * - TEST-021 (AC-021 / NFR-007 maintainability): a new source type can
 *   be wired into the contract with one register() call + one dry-run
 *   test, without touching existing branches.
 */

import { describe, it, expect } from "bun:test";

import {
  ExtractorAlreadyRegisteredError,
  ExtractorNotRegisteredError,
  ExtractorRegistry,
  InvalidSourceTypeError,
  isSourceType,
  routeAndExtract,
  SOURCE_TYPE,
  type Extractor,
  type ExtractorInput,
  type ExtractorOutput,
  type SourceType,
} from "../../src/extraction/router";

/**
 * Build a deterministic mock extractor for the given source type.
 * Returns `{ result: { echo: rawContent.length } }` so tests can
 * assert dispatch reached the right extractor.
 */
function mockExtractor(sourceType: SourceType): Extractor {
  return {
    sourceType,
    async extract(input: ExtractorInput): Promise<ExtractorOutput> {
      return {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        extractedAt: "2026-05-19T00:00:00.000Z",
        result: { echo: input.rawContent.length, tag: sourceType },
      };
    },
  };
}

function newInput(
  sourceType: SourceType,
  overrides: Partial<ExtractorInput> = {},
): ExtractorInput {
  return {
    sourceType,
    sourceId: "src_test",
    rawContent: "abc",
    ...overrides,
  };
}

describe("SOURCE_TYPE enum (REQ-009)", () => {
  it("includes exactly article / dataset / report in canonical order", () => {
    expect(SOURCE_TYPE).toEqual(["article", "dataset", "report"]);
  });

  it("isSourceType accepts canonical values", () => {
    expect(isSourceType("article")).toBe(true);
    expect(isSourceType("dataset")).toBe(true);
    expect(isSourceType("report")).toBe(true);
  });

  it("isSourceType rejects off-canonical strings", () => {
    expect(isSourceType("Article")).toBe(false); // case-sensitive
    expect(isSourceType("blog")).toBe(false);
    expect(isSourceType("")).toBe(false);
  });

  it("isSourceType rejects non-string values", () => {
    expect(isSourceType(null)).toBe(false);
    expect(isSourceType(undefined)).toBe(false);
    expect(isSourceType(42)).toBe(false);
    expect(isSourceType({})).toBe(false);
  });
});

describe("ExtractorRegistry — registration + lookup", () => {
  it("register + get round-trips a single extractor", () => {
    const reg = new ExtractorRegistry();
    const ext = mockExtractor("article");
    reg.register(ext);
    expect(reg.get("article")).toBe(ext);
  });

  it("registeredSourceTypes() reflects registration order", () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    reg.register(mockExtractor("report"));
    expect(reg.registeredSourceTypes()).toEqual(["article", "report"]);
  });

  it("get() throws ExtractorNotRegisteredError for unregistered type", () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    expect(() => reg.get("dataset")).toThrow(ExtractorNotRegisteredError);
  });

  it("register() throws ExtractorAlreadyRegisteredError on duplicate", () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    expect(() => reg.register(mockExtractor("article"))).toThrow(
      ExtractorAlreadyRegisteredError,
    );
  });

  it("register() throws InvalidSourceTypeError on off-canonical sourceType", () => {
    const reg = new ExtractorRegistry();
    const bad = {
      sourceType: "blog",
      async extract(): Promise<ExtractorOutput> {
        throw new Error("unreachable");
      },
    } as unknown as Extractor;
    expect(() => reg.register(bad)).toThrow(InvalidSourceTypeError);
  });

  it("ExtractorNotRegisteredError carries the sourceType field", () => {
    const reg = new ExtractorRegistry();
    try {
      reg.get("dataset");
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractorNotRegisteredError);
      expect((err as ExtractorNotRegisteredError).sourceType).toBe("dataset");
      return;
    }
    throw new Error("expected ExtractorNotRegisteredError");
  });
});

describe("routeAndExtract — TEST-009 dispatch (AC-009)", () => {
  it("routes article input to the article extractor", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    reg.register(mockExtractor("dataset"));
    reg.register(mockExtractor("report"));
    const out = await routeAndExtract(reg, newInput("article"));
    expect(out.sourceType).toBe("article");
    expect((out.result as { tag: string }).tag).toBe("article");
  });

  it("routes dataset input to the dataset extractor", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    reg.register(mockExtractor("dataset"));
    reg.register(mockExtractor("report"));
    const out = await routeAndExtract(reg, newInput("dataset"));
    expect(out.sourceType).toBe("dataset");
    expect((out.result as { tag: string }).tag).toBe("dataset");
  });

  it("routes report input to the report extractor", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    reg.register(mockExtractor("dataset"));
    reg.register(mockExtractor("report"));
    const out = await routeAndExtract(reg, newInput("report"));
    expect(out.sourceType).toBe("report");
    expect((out.result as { tag: string }).tag).toBe("report");
  });

  it("preserves sourceId / rawContent length through dispatch", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    const out = await routeAndExtract(
      reg,
      newInput("article", { sourceId: "src_abc123", rawContent: "hello" }),
    );
    expect(out.sourceId).toBe("src_abc123");
    expect((out.result as { echo: number }).echo).toBe(5);
  });

  it("fails closed when sourceType has no registered extractor", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    await expect(routeAndExtract(reg, newInput("dataset"))).rejects.toThrow(
      ExtractorNotRegisteredError,
    );
  });
});

describe("routeAndExtract — input validation (fail-closed)", () => {
  it("rejects off-canonical sourceType (InvalidSourceTypeError)", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    await expect(
      // @ts-expect-error — intentional off-canonical for defense test
      routeAndExtract(reg, { ...newInput("article"), sourceType: "blog" }),
    ).rejects.toThrow(InvalidSourceTypeError);
  });

  it("rejects empty sourceId (TypeError)", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    await expect(
      routeAndExtract(reg, newInput("article", { sourceId: "" })),
    ).rejects.toThrow(TypeError);
  });

  it("rejects non-string rawContent (TypeError)", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    await expect(
      // @ts-expect-error — intentional non-string for defense test
      routeAndExtract(reg, newInput("article", { rawContent: 42 })),
    ).rejects.toThrow(TypeError);
  });

  it("rejects null input (TypeError)", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    await expect(
      // @ts-expect-error — intentional null for defense test
      routeAndExtract(reg, null),
    ).rejects.toThrow(TypeError);
  });
});

describe("routeAndExtract — extractor failure propagation + mutation defense", () => {
  it("propagates extractor throw without masking it", async () => {
    class ExtractorBoomError extends Error {
      constructor() {
        super("simulated extractor failure");
        this.name = "ExtractorBoomError";
      }
    }
    const throwingExtractor: Extractor = {
      sourceType: "article",
      async extract(): Promise<ExtractorOutput> {
        throw new ExtractorBoomError();
      },
    };
    const reg = new ExtractorRegistry();
    reg.register(throwingExtractor);
    await expect(routeAndExtract(reg, newInput("article"))).rejects.toThrow(
      ExtractorBoomError,
    );
  });

  it("snapshots input fields before extractor await — mutation of input.sourceId by extractor cannot bypass envelope check", async () => {
    // ExtractorInput is `readonly` at the type level, but TS does
    // not enforce immutability at runtime. The router snapshots
    // sourceType + sourceId BEFORE the await so a mutating extractor
    // cannot retroactively make the post-dispatch consistency check
    // pass for the wrong sourceId.
    const mutatingExtractor: Extractor = {
      sourceType: "article",
      async extract(input): Promise<ExtractorOutput> {
        // Mutate the input to match a different sourceId.
        (input as { sourceId: string }).sourceId = "src_OTHER";
        return {
          sourceType: input.sourceType,
          sourceId: "src_OTHER",
          extractedAt: "2026-05-19T00:00:00.000Z",
          result: null,
        };
      },
    };
    const reg = new ExtractorRegistry();
    reg.register(mutatingExtractor);
    await expect(
      routeAndExtract(reg, newInput("article", { sourceId: "src_orig" })),
    ).rejects.toThrow(/sourceId=src_OTHER/);
  });
});

describe("routeAndExtract — envelope-consistency fail-closed", () => {
  it("fails closed when extractor returns mismatched sourceType", async () => {
    const liarExtractor: Extractor = {
      sourceType: "article",
      async extract(input): Promise<ExtractorOutput> {
        return {
          sourceType: "dataset", // mismatch — should fail
          sourceId: input.sourceId,
          extractedAt: "2026-05-19T00:00:00.000Z",
          result: null,
        };
      },
    };
    const reg = new ExtractorRegistry();
    reg.register(liarExtractor);
    await expect(routeAndExtract(reg, newInput("article"))).rejects.toThrow(
      /sourceType=dataset/,
    );
  });

  it("fails closed when extractor returns mismatched sourceId", async () => {
    const liarExtractor: Extractor = {
      sourceType: "article",
      async extract(input): Promise<ExtractorOutput> {
        return {
          sourceType: input.sourceType,
          sourceId: "src_OTHER", // mismatch
          extractedAt: "2026-05-19T00:00:00.000Z",
          result: null,
        };
      },
    };
    const reg = new ExtractorRegistry();
    reg.register(liarExtractor);
    await expect(
      routeAndExtract(reg, newInput("article", { sourceId: "src_orig" })),
    ).rejects.toThrow(/sourceId=src_OTHER/);
  });
});

describe("Extractor interface contract (TEST-021 — AC-021 / NFR-007)", () => {
  // AC-021 contract: adding a new source type is a one-line register()
  // + one dry-run test, without modifying existing branches. We
  // simulate that here by introducing a hypothetical "report"-style
  // extractor instance that uses a different result shape from the
  // mockExtractor used in TEST-009 above. The existing
  // article/dataset/report branches above must remain unchanged.
  it("a fresh source-type implementation routes without touching existing extractors (dry-run extensibility)", async () => {
    const reg = new ExtractorRegistry();
    reg.register(mockExtractor("article"));
    reg.register(mockExtractor("dataset"));

    // Dry-run wire: a new "report" extractor with a distinct result
    // shape (page locator). The contract requires only `sourceType`
    // + `extract()` — nothing else changes in the registry / router.
    const newReportExtractor: Extractor = {
      sourceType: "report",
      async extract(input): Promise<ExtractorOutput> {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          extractedAt: "2026-05-19T00:00:00.000Z",
          // Different result shape than mockExtractor — distinct
          // structure, no impact on article/dataset branches.
          result: { pageLocator: [{ page: 1, anchor: "summary" }] },
        };
      },
    };
    reg.register(newReportExtractor);

    // 1. New type dispatches correctly.
    const reportOut = await routeAndExtract(reg, newInput("report"));
    expect(
      (reportOut.result as { pageLocator: unknown[] }).pageLocator.length,
    ).toBe(1);

    // 2. Existing article branch is unchanged.
    const articleOut = await routeAndExtract(reg, newInput("article"));
    expect((articleOut.result as { tag: string }).tag).toBe("article");

    // 3. Existing dataset branch is unchanged.
    const datasetOut = await routeAndExtract(reg, newInput("dataset"));
    expect((datasetOut.result as { tag: string }).tag).toBe("dataset");
  });

  it("Extractor interface requires sourceType + extract() and nothing more (structural)", () => {
    // Compile-time-only structural check: an object satisfying the
    // minimal interface is assignable to Extractor.
    const minimal: Extractor = {
      sourceType: "article",
      async extract(input) {
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          extractedAt: "2026-05-19T00:00:00.000Z",
          result: null,
        };
      },
    };
    expect(typeof minimal.extract).toBe("function");
    expect(minimal.sourceType).toBe("article");
  });
});
