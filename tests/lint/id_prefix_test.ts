/**
 * TEST-005 — ID prefix lint (AC-005)
 * Verifies that every domain object type uses the required `<prefix>_` format
 * (ADR-0011, ADR-0024, ADR-0025).
 */

import { describe, it, expect } from "bun:test";
import {
  validateIdPrefix,
  validateScenarioRevisionId,
  assertIdPrefix,
  ID_PREFIXES,
  type DomainObjectType,
} from "../../src/domain/ids";

// ---------------------------------------------------------------------------
// Positive cases — valid IDs for each type
// ---------------------------------------------------------------------------
describe("ID prefix validation — valid IDs", () => {
  const validSamples: Array<[DomainObjectType, string]> = [
    ["Source",             "src_01HZABCDEF1234567890ABCDE"],
    ["Document",           "doc_01HZABCDEF1234567890ABCDE"],
    ["Snapshot",           "snap_01HZABCDEF1234567890ABCDE"],
    ["Claim",              "clm_01HZABCDEF1234567890ABCDE"],
    ["Dossier",            "dos_01HZABCDEF1234567890ABCDE"],
    ["Scenario",           "scn_01HZABCDEF1234567890ABCDE"],
    ["EditorialIntent",    "eit_a3f8b912c4"],
    ["Thesis",             "ths_01HZABCDEF1234567890ABCDE"],
    ["ContentDraft",       "drf_01HZABCDEF1234567890ABCDE"],
    ["Publication",        "pub_01HZABCDEF1234567890ABCDE"],
    ["EdgeRelation",       "edge_01HZABCDEF1234567890ABCDE"],
    ["Run",                "run_01HZABCDEF1234567890ABCDE"],
    ["AccessIntervention", "aci_01HZABCDEF1234567890ABCDE"],
    ["ManualClaimEntry",   "mcl_01HZABCDEF1234567890ABCDE"],
    ["DerivedMetric",      "met_01HZABCDEF1234567890ABCDE"],
  ];

  for (const [type, id] of validSamples) {
    it(`${type}: '${id}' is valid`, () => {
      expect(validateIdPrefix(type, id)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Negative cases — wrong or missing prefix
// ---------------------------------------------------------------------------
describe("ID prefix validation — invalid IDs", () => {
  const invalidSamples: Array<[DomainObjectType, string, string]> = [
    ["Source",    "doc_01HZABCDEF", "wrong prefix"],
    ["Claim",     "CLM_01HZABCDEF", "wrong case"],
    ["Dossier",   "01HZABCDEF",     "no prefix"],
    ["Thesis",    "",                "empty string"],
    ["Publication", "pub01HZABCDEF","missing underscore"],
    ["EditorialIntent", "eit01HZAB","missing underscore"],
    ["DerivedMetric", "metric_01HZ","wrong prefix word"],
  ];

  for (const [type, id, reason] of invalidSamples) {
    it(`${type}: '${id}' is invalid (${reason})`, () => {
      expect(validateIdPrefix(type, id)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// assertIdPrefix throws on invalid
// ---------------------------------------------------------------------------
describe("assertIdPrefix", () => {
  it("does not throw on valid ID", () => {
    expect(() => assertIdPrefix("Source", "src_123")).not.toThrow();
  });

  it("throws on invalid ID", () => {
    expect(() => assertIdPrefix("Source", "doc_123")).toThrow(
      /does not start with expected prefix/
    );
  });
});

// ---------------------------------------------------------------------------
// ScenarioRevision composite ID format
// ---------------------------------------------------------------------------
describe("ScenarioRevision ID format", () => {
  it("accepts valid composite ID", () => {
    expect(validateScenarioRevisionId("scn_01HZABCDEF_r1")).toBe(true);
    expect(validateScenarioRevisionId("scn_01HZABCDEF_r42")).toBe(true);
  });

  it("rejects malformed composite IDs", () => {
    expect(validateScenarioRevisionId("scn_01HZABCDEF")).toBe(false);
    expect(validateScenarioRevisionId("scn_01HZABCDEF_r")).toBe(false);
    expect(validateScenarioRevisionId("01HZABCDEF_r1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Completeness: all prefix values are distinct (no collision)
// ---------------------------------------------------------------------------
describe("ID prefix table integrity", () => {
  it("all prefixes are unique strings", () => {
    const values = Object.values(ID_PREFIXES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("all prefixes end with underscore", () => {
    for (const [type, prefix] of Object.entries(ID_PREFIXES)) {
      expect(prefix.endsWith("_"), `${type} prefix '${prefix}' must end with '_'`).toBe(true);
    }
  });
});
