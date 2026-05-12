/**
 * TEST-027: AC-027 source_perspective distribution lint for Tier A seed.
 * Reads data/sources_seed.yaml and asserts:
 *   risk_observer    ≤ 50%
 *   opportunity_observer ≥ 25%
 *   neutral          ≥ 15%
 * REQ-022 canonical labels only.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// Minimal YAML parser for the flat list structure used in sources_seed.yaml.
// We only need to extract `source_perspective:` values; no full YAML parse needed.
function extractPerspectiveValues(yaml: string): string[] {
  const values: string[] = [];
  for (const line of yaml.split("\n")) {
    const match = line.match(/^\s{4}source_perspective:\s+(\S+)/);
    if (match) {
      values.push(match[1]!);
    }
  }
  return values;
}

function countByValue(arr: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of arr) {
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

const SEED_PATH = join(import.meta.dir, "../../data/sources_seed.yaml");

let perspectives: string[] = [];
let counts: Record<string, number> = {};
let total = 0;

beforeAll(() => {
  const yaml = readFileSync(SEED_PATH, "utf-8");
  perspectives = extractPerspectiveValues(yaml);
  counts = countByValue(perspectives);
  total = perspectives.length;
});

// ---------------------------------------------------------------------------
// REQ-022 canonical label enforcement
// ---------------------------------------------------------------------------
describe("REQ-022 canonical source_perspective labels", () => {
  const VALID = new Set(["risk_observer", "opportunity_observer", "neutral", "mixed"]);

  it("contains only canonical perspective labels", () => {
    const invalid = perspectives.filter((p) => !VALID.has(p));
    expect(invalid).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seed size
// ---------------------------------------------------------------------------
describe("Tier A seed size", () => {
  it("has exactly 72 Tier A sources", () => {
    expect(total).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// AC-027 distribution bounds
// ---------------------------------------------------------------------------
describe("AC-027 distribution bounds (Tier A seed 72 sources)", () => {
  it("risk_observer ≤ 50%", () => {
    const pct = ((counts["risk_observer"] ?? 0) / total) * 100;
    expect(pct).toBeLessThanOrEqual(50);
  });

  it("opportunity_observer ≥ 25%", () => {
    const pct = ((counts["opportunity_observer"] ?? 0) / total) * 100;
    expect(pct).toBeGreaterThanOrEqual(25);
  });

  it("neutral ≥ 15%", () => {
    const pct = ((counts["neutral"] ?? 0) / total) * 100;
    expect(pct).toBeGreaterThanOrEqual(15);
  });

  it("reports actual distribution (informational)", () => {
    const riskPct = (((counts["risk_observer"] ?? 0) / total) * 100).toFixed(1);
    const oppPct = (((counts["opportunity_observer"] ?? 0) / total) * 100).toFixed(1);
    const neutralPct = (((counts["neutral"] ?? 0) / total) * 100).toFixed(1);
    const mixedPct = (((counts["mixed"] ?? 0) / total) * 100).toFixed(1);
    // Not a real assertion — just ensures the numbers can be computed.
    expect(Number(riskPct) + Number(oppPct) + Number(neutralPct) + Number(mixedPct)).toBeCloseTo(100, 0);
  });
});
