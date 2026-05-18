// Unit tests for src/domain/snapshot-id — the shared constants and parsers
// consolidated by INFRA-1A.x-shared-snapshot-id-constants
// (PR #66 Cycle 10 Finding 6 anchor).
//
// The behaviors mirrored here also live in
//   - tests/unit/audit_policy_decisions_test.ts (writer-boundary assert)
//   - tests/unit/r2_invariant_scanner_test.ts (parser delimiter strictness,
//     reader-boundary nullable shape guard)
// Pre-consolidation those tests guarded local copies of the regex; this
// suite guards the shared module directly so a regex/prefix change in
// snapshot-id.ts fails here first, independent of consumer wiring.

import { describe, expect, it } from "bun:test";
import {
  SNAPSHOT_ID_REGEX,
  RATIONALE_SNAP_ID_PREFIX_REGEX,
  SNAPSHOT_R2_KEY_PREFIX,
  assertValidSnapId,
  formatSnapIdRationalePrefix,
  parseSnapIdFromRationale,
  snapshotR2Key,
  validSnapIdOrNull,
} from "../../src/domain/snapshot-id";

describe("SNAPSHOT_ID_REGEX — canonical shape", () => {
  it("accepts snap_ + ULID + dashes + underscores", () => {
    expect(SNAPSHOT_ID_REGEX.test("snap_01KRRR")).toBe(true);
    expect(SNAPSHOT_ID_REGEX.test("snap_ABC123")).toBe(true);
    expect(SNAPSHOT_ID_REGEX.test("snap_with-dashes_and_underscores")).toBe(true);
  });

  it("rejects empty / missing-prefix / lone-prefix / invalid chars", () => {
    expect(SNAPSHOT_ID_REGEX.test("")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("ABC123")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap_")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap_with space")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap_with/slash")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap_with.dot")).toBe(false);
    expect(SNAPSHOT_ID_REGEX.test("snap_with@at")).toBe(false);
  });
});

describe("SNAPSHOT_R2_KEY_PREFIX — canonical R2 prefix", () => {
  it("matches the documented permitted-prefix literal", () => {
    expect(SNAPSHOT_R2_KEY_PREFIX).toBe("permitted_artifact/derived/snapshot/");
  });

  it("ends in a slash so snapshotR2Key concatenation cannot accidentally bridge segments", () => {
    expect(SNAPSHOT_R2_KEY_PREFIX.endsWith("/")).toBe(true);
  });
});

describe("snapshotR2Key — deterministic key builder", () => {
  it("concatenates prefix + snapId verbatim", () => {
    expect(snapshotR2Key("snap_ABC")).toBe(
      "permitted_artifact/derived/snapshot/snap_ABC"
    );
  });

  it("throws on malformed snap_id (Opus PR #66~#78 review F9)", () => {
    // Updated contract: snapshotR2Key now self-validates via assertValidSnapId.
    // Pre-fix the helper concatenated any input verbatim ("anything-goes"
    // would silently become an R2 object key prefix). Now the writer-boundary
    // assertion mirrors recordR2UploadDecision's fail-fast (PR #62) so a
    // malformed snap_id can never escape into R2 key construction.
    expect(() => snapshotR2Key("anything-goes")).toThrow(
      /snapshotR2Key: invalid snap_id shape/
    );
    expect(() => snapshotR2Key("snap_with space")).toThrow(
      /snapshotR2Key: invalid snap_id shape/
    );
    expect(() => snapshotR2Key("")).toThrow(
      /snapshotR2Key: invalid snap_id shape/
    );
  });
});

describe("validSnapIdOrNull — reader-boundary nullable guard", () => {
  it("returns the value when shape matches", () => {
    expect(validSnapIdOrNull("snap_01KRRR")).toBe("snap_01KRRR");
  });

  it("returns null for null / undefined / empty / malformed", () => {
    expect(validSnapIdOrNull(null)).toBeNull();
    expect(validSnapIdOrNull(undefined)).toBeNull();
    expect(validSnapIdOrNull("")).toBeNull();
    expect(validSnapIdOrNull("ABC")).toBeNull();
    expect(validSnapIdOrNull("snap_bad@char")).toBeNull();
  });
});

describe("assertValidSnapId — writer-boundary fail-fast", () => {
  it("does not throw on well-formed snap_id", () => {
    expect(() => assertValidSnapId("snap_01KRRR")).not.toThrow();
  });

  it("throws with /invalid snap_id shape/ on malformed input", () => {
    expect(() => assertValidSnapId("")).toThrow(/invalid snap_id shape/);
    expect(() => assertValidSnapId("ABC123")).toThrow(/invalid snap_id shape/);
    expect(() => assertValidSnapId("snap_")).toThrow(/invalid snap_id shape/);
    expect(() => assertValidSnapId("snap_with space")).toThrow(/invalid snap_id shape/);
  });

  it("includes optional context as prefix in the error message", () => {
    expect(() => assertValidSnapId("bad", "myCaller")).toThrow(
      /^myCaller: invalid snap_id shape/
    );
  });

  it("omits the context prefix when not provided", () => {
    try {
      assertValidSnapId("bad");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message.startsWith("invalid snap_id shape")).toBe(true);
    }
  });
});

describe("parseSnapIdFromRationale — Cycle 10 delimiter strictness", () => {
  it("parses the canonical `snap_id=<id>; ...` prefix", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A; archive_policy=x")).toBe(
      "snap_A"
    );
  });

  it("parses snap_id at end-of-string (no trailing semicolon)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_LONE")).toBe("snap_LONE");
  });

  it("returns null for null / undefined / empty rationale", () => {
    expect(parseSnapIdFromRationale(null)).toBeNull();
    expect(parseSnapIdFromRationale(undefined)).toBeNull();
    expect(parseSnapIdFromRationale("")).toBeNull();
  });

  it("returns null when the prefix is not anchored at start-of-string", () => {
    expect(parseSnapIdFromRationale("prefix snap_id=snap_X; ...")).toBeNull();
  });

  it("returns null on invalid trailing chars (no truncation regression)", () => {
    // Pre-Cycle-10 these would silently truncate to "snap_A".
    expect(parseSnapIdFromRationale("snap_id=snap_A@bad; ...")).toBeNull();
    expect(parseSnapIdFromRationale("snap_id=snap_A.foo; ...")).toBeNull();
    expect(parseSnapIdFromRationale("snap_id=snap_A/evil; ...")).toBeNull();
    expect(parseSnapIdFromRationale("snap_id=snap_A=evil; ...")).toBeNull();
    expect(parseSnapIdFromRationale("snap_id=snap_A archive_policy=x")).toBeNull();
  });
});

describe("formatSnapIdRationalePrefix — writer-side prefix builder", () => {
  it("builds the canonical `snap_id=<id>` prefix without trailing delimiter", () => {
    expect(formatSnapIdRationalePrefix("snap_ABC")).toBe("snap_id=snap_ABC");
  });

  it("round-trips with parseSnapIdFromRationale when caller appends `;`", () => {
    const built = `${formatSnapIdRationalePrefix("snap_RT")}; archive_policy=full_snapshot_allowed`;
    expect(parseSnapIdFromRationale(built)).toBe("snap_RT");
  });

  it("round-trips with parseSnapIdFromRationale at end-of-string (no `;`)", () => {
    expect(parseSnapIdFromRationale(formatSnapIdRationalePrefix("snap_END"))).toBe("snap_END");
  });

  it("throws on malformed snap_id (Opus PR #66~#78 review F9)", () => {
    // Updated contract: formatSnapIdRationalePrefix now self-validates so a
    // future caller (bulk-import tooling, REPL, etc.) cannot emit a
    // canonical-looking rationale prefix that parseSnapIdFromRationale would
    // then reject as malformed (reader/writer drift surface). Mirrors the
    // snapshotR2Key F9 hardening.
    expect(() => formatSnapIdRationalePrefix("anything-goes")).toThrow(
      /formatSnapIdRationalePrefix: invalid snap_id shape/
    );
    expect(() => formatSnapIdRationalePrefix("")).toThrow(
      /formatSnapIdRationalePrefix: invalid snap_id shape/
    );
  });
});

describe("RATIONALE_SNAP_ID_PREFIX_REGEX — shape", () => {
  it("captures exactly the snap_id token before the `;` or end-of-string", () => {
    const m1 = RATIONALE_SNAP_ID_PREFIX_REGEX.exec("snap_id=snap_X; archive_policy=y");
    expect(m1?.[1]).toBe("snap_X");
    const m2 = RATIONALE_SNAP_ID_PREFIX_REGEX.exec("snap_id=snap_END");
    expect(m2?.[1]).toBe("snap_END");
  });
});
