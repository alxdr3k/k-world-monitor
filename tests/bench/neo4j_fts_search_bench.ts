/**
 * TEST-002 / SPIKE-001 — Neo4j native FTS keyword search + 1-hop traversal bench
 * AC-002: cold cache p95 < 1초 with 10,000 graph objects (NFR-001)
 *
 * Prerequisites: Neo4j running with v1_schema.cypher applied + 10k fixture loaded.
 * Run: bun run bench:neo4j
 *
 * If NEO4J_PASSWORD is unset the bench is skipped (not a test failure).
 */

import { withSession, closeDriver } from "../../src/storage/neo4j/connection";

const OBJECT_COUNT = 10_000;
const PERCENTILE_TARGET = 0.95;
const LATENCY_BUDGET_MS = 1_000;
const SAMPLE_QUERIES = [
  "inflation risk",
  "monetary policy Fed",
  "geopolitical tension",
  "semiconductor supply chain",
  "climate transition",
  "labor market",
  "currency volatility",
  "debt ceiling",
  "energy price",
  "emerging markets",
];

function percentile(sortedMs: number[], p: number): number {
  const idx = Math.ceil(sortedMs.length * p) - 1;
  return sortedMs[Math.max(0, idx)] ?? 0;
}

async function bench(): Promise<void> {
  if (!process.env["NEO4J_PASSWORD"]) {
    console.log("[bench] NEO4J_PASSWORD not set — skipping SPIKE-001 bench (planned).");
    return;
  }

  const latencies: number[] = [];

  for (const query of SAMPLE_QUERIES) {
    const start = performance.now();

    await withSession(async (session) => {
      // FTS keyword search + 1-hop traversal (AC-002)
      await session.run(
        `CALL db.index.fulltext.queryNodes('claim_fts', $query)
         YIELD node AS claim, score
         OPTIONAL MATCH (claim)-[:SUPPORTS|:CONTRADICTS|:QUALIFIES]-(related)
         RETURN claim.claim_id, score, collect(related.claim_id)[..5] AS neighbors
         LIMIT 20`,
        { query }
      );
    });

    latencies.push(performance.now() - start);
  }

  const sorted = latencies.slice().sort((a, b) => a - b);
  const p95 = percentile(sorted, PERCENTILE_TARGET);
  const p50 = percentile(sorted, 0.5);

  console.log(`\nSPIKE-001 Neo4j FTS bench results (n=${SAMPLE_QUERIES.length} queries)`);
  console.log(`  p50: ${p50.toFixed(1)}ms`);
  console.log(`  p95: ${p95.toFixed(1)}ms  (budget: ${LATENCY_BUDGET_MS}ms)`);
  console.log(`  NFR-001 AC-002: ${p95 < LATENCY_BUDGET_MS ? "✓ PASS" : "✗ FAIL"}`);

  if (p95 >= LATENCY_BUDGET_MS) {
    console.error(`\nNFR-001 violated: p95=${p95.toFixed(1)}ms > ${LATENCY_BUDGET_MS}ms. See SPIKE-001 in docs/04_IMPLEMENTATION_PLAN.md.`);
    process.exit(1);
  }
}

bench()
  .then(() => closeDriver())
  .catch((err) => {
    console.error(err);
    closeDriver().finally(() => process.exit(1));
  });

export { OBJECT_COUNT, LATENCY_BUDGET_MS };
