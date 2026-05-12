/**
 * Unit tests for bidirectional schema enum validators.
 * AC-026: Thesis.stance, Scenario impact fields.
 * AC-027: Source.source_perspective distribution constraint.
 * ADR-0019
 */

import { describe, it, expect } from "bun:test";
import {
  isThesisStance,
  isThesisMarketStance,
  isSourcePerspective,
  THESIS_STANCE,
  THESIS_MARKET_STANCE,
  SOURCE_PERSPECTIVE,
} from "../../src/utils/enums";

// ---------------------------------------------------------------------------
// THESIS_STANCE (AC-026)
// ---------------------------------------------------------------------------
describe("isThesisStance", () => {
  it.each(THESIS_STANCE as unknown as string[])("accepts '%s'", (v) => {
    expect(isThesisStance(v)).toBe(true);
  });

  it("covers all 6 AC-026 required values", () => {
    expect(THESIS_STANCE).toHaveLength(6);
    const required = ["constructive", "cautionary", "neutral", "mixed", "asymmetric", "exploratory"];
    for (const v of required) {
      expect(isThesisStance(v)).toBe(true);
    }
  });

  it("rejects unknown stance", () => {
    expect(isThesisStance("positive")).toBe(false);
    expect(isThesisStance("negative")).toBe(false);
    expect(isThesisStance("")).toBe(false);
    expect(isThesisStance(null)).toBe(false);
    expect(isThesisStance(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THESIS_MARKET_STANCE (ADR-0019)
// ---------------------------------------------------------------------------
describe("isThesisMarketStance", () => {
  it.each(THESIS_MARKET_STANCE as unknown as string[])("accepts '%s'", (v) => {
    expect(isThesisMarketStance(v)).toBe(true);
  });

  it("covers all 6 market stance values", () => {
    expect(THESIS_MARKET_STANCE).toHaveLength(6);
    const required = ["bullish", "bearish", "range_bound", "volatility_up", "volatility_down", "neutral"];
    for (const v of required) {
      expect(isThesisMarketStance(v)).toBe(true);
    }
  });

  it("rejects unknown market stance", () => {
    expect(isThesisMarketStance("up")).toBe(false);
    expect(isThesisMarketStance("down")).toBe(false);
    expect(isThesisMarketStance("")).toBe(false);
    expect(isThesisMarketStance(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SOURCE_PERSPECTIVE (AC-027)
// ---------------------------------------------------------------------------
describe("isSourcePerspective", () => {
  it.each(SOURCE_PERSPECTIVE as unknown as string[])("accepts '%s'", (v) => {
    expect(isSourcePerspective(v)).toBe(true);
  });

  it("covers all 4 AC-027 required values", () => {
    expect(SOURCE_PERSPECTIVE).toHaveLength(4);
    const required = ["risk", "opportunity", "neutral", "mixed"];
    for (const v of required) {
      expect(isSourcePerspective(v)).toBe(true);
    }
  });

  it("rejects unknown perspective", () => {
    expect(isSourcePerspective("negative")).toBe(false);
    expect(isSourcePerspective("positive")).toBe(false);
    expect(isSourcePerspective("risk_observer")).toBe(false);
    expect(isSourcePerspective("")).toBe(false);
    expect(isSourcePerspective(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-027 distribution constraint (≤50% risk, ≥25% opportunity, ≥15% neutral)
// Tested as a helper function to validate a source portfolio
// ---------------------------------------------------------------------------
describe("AC-027 source_perspective distribution constraint", () => {
  function checkDistribution(perspectives: string[]): {
    valid: boolean;
    riskPct: number;
    opportunityPct: number;
    neutralPct: number;
  } {
    const total = perspectives.length;
    if (total === 0) return { valid: false, riskPct: 0, opportunityPct: 0, neutralPct: 0 };
    const riskPct = (perspectives.filter((p) => p === "risk").length / total) * 100;
    const opportunityPct = (perspectives.filter((p) => p === "opportunity").length / total) * 100;
    const neutralPct = (perspectives.filter((p) => p === "neutral").length / total) * 100;
    return {
      valid: riskPct <= 50 && opportunityPct >= 25 && neutralPct >= 15,
      riskPct,
      opportunityPct,
      neutralPct,
    };
  }

  it("passes a compliant distribution (40% risk, 40% opportunity, 20% neutral)", () => {
    const portfolio = [
      ...Array(4).fill("risk"),
      ...Array(4).fill("opportunity"),
      ...Array(2).fill("neutral"),
    ];
    const result = checkDistribution(portfolio);
    expect(result.valid).toBe(true);
    expect(result.riskPct).toBe(40);
    expect(result.opportunityPct).toBe(40);
    expect(result.neutralPct).toBe(20);
  });

  it("fails when risk_observer exceeds 50%", () => {
    const portfolio = [
      ...Array(6).fill("risk"),
      ...Array(3).fill("opportunity"),
      ...Array(1).fill("neutral"),
    ];
    const result = checkDistribution(portfolio);
    expect(result.valid).toBe(false);
    expect(result.riskPct).toBeGreaterThan(50);
  });

  it("fails when opportunity_observer is below 25%", () => {
    const portfolio = [
      ...Array(5).fill("risk"),
      ...Array(2).fill("opportunity"),
      ...Array(3).fill("neutral"),
    ];
    const result = checkDistribution(portfolio);
    expect(result.valid).toBe(false);
    expect(result.opportunityPct).toBeLessThan(25);
  });

  it("fails when neutral is below 15%", () => {
    const portfolio = [
      ...Array(4).fill("risk"),
      ...Array(5).fill("opportunity"),
      ...Array(1).fill("neutral"),
    ];
    const result = checkDistribution(portfolio);
    expect(result.valid).toBe(false);
    expect(result.neutralPct).toBeLessThan(15);
  });

  it("passes at the exact boundary (50% risk, 25% opportunity, 15% neutral + 10% mixed)", () => {
    const portfolio = [
      ...Array(10).fill("risk"),
      ...Array(5).fill("opportunity"),
      ...Array(3).fill("neutral"),
      ...Array(2).fill("mixed"),
    ];
    const result = checkDistribution(portfolio);
    expect(result.valid).toBe(true);
    expect(result.riskPct).toBe(50);
    expect(result.opportunityPct).toBe(25);
    expect(result.neutralPct).toBe(15);
  });
});
