// Shared Neo4j mock builder for unit tests.
//
// The previous ad-hoc inline mocks (snapshot_fingerprint_test, chunker_test,
// feedback_test, access_intervention_test) each:
//   - Re-implemented a `withSession` stub with substring-matching query
//     handlers. Substring-matching is brittle: a one-character query edit
//     silently disables the matcher and the test passes for the wrong reason.
//   - Re-implemented tx commit/rollback counters (chunker_test only).
//   - Conflated tx.run and session.run paths under a single mock map, so
//     a code change that moves a query from inside a tx to outside is not
//     observable.
//
// This helper consolidates the pattern. Tests register query handlers by
// regex (or substring as a fallback), distinguish tx vs session execution,
// and read commit/rollback counters from the returned controller.
//
// Usage:
//
//   const neo4j = createNeo4jMock();
//   neo4j.tx.on(/RETURN count\(src\) AS matched/, () =>
//     ok({ matched: 1 })
//   );
//   neo4j.tx.on(/MERGE \(d:Document/, ({ params }) =>
//     ok({ doc_id: params.docId })
//   );
//
//   mock.module("../../src/storage/neo4j/connection", () => neo4j.module);
//   // ... import code under test, run, assert
//   expect(neo4j.tx.commitCount).toBe(1);
//   expect(neo4j.tx.rollbackCount).toBe(0);
//   expect(neo4j.runs).toContainEqual(expect.objectContaining({ ... }));

type QueryRecord = { query: string; params: Record<string, unknown>; via: "tx" | "session" };
type HandlerResult = { records: Array<{ get: (key: string) => unknown }> } | Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
type HandlerCtx = { query: string; params: Record<string, unknown> };
type Handler = (ctx: HandlerCtx) => HandlerResult;

// Build a records-shaped response from a flat object map of column → value.
export function ok(row: Record<string, unknown>): { records: Array<{ get: (key: string) => unknown }> } {
  return {
    records: [{ get: (key: string) => row[key] ?? null }],
  };
}

// Build a records-shaped response with zero rows.
export function none(): { records: Array<{ get: (key: string) => unknown }> } {
  return { records: [] };
}

interface ExecScope {
  on(matcher: RegExp | string, handler: Handler): void;
  /** Number of `commit()` calls observed on this scope (tx only). */
  readonly commitCount: number;
  /** Number of `rollback()` calls observed on this scope (tx only). */
  readonly rollbackCount: number;
  /** When set, the NEXT commit() rejects with this error and clears the slot. */
  failNextCommit(err: Error): void;
}

export interface Neo4jMockController {
  /** All recorded runs (tx + session combined, in call order). */
  readonly runs: ReadonlyArray<QueryRecord>;
  /** Recorder reset between tests. Clears runs + counters + queued failures. */
  reset(): void;
  /** Handlers for tx.run() (inside beginTransaction). */
  tx: ExecScope;
  /** Handlers for session.run() (outside transaction). */
  session: ExecScope;
  /** The module-shaped object to pass into bun:test's mock.module(). */
  module: { withSession: <T>(fn: (session: unknown) => Promise<T>) => Promise<T> };
}

interface HandlerEntry {
  match: (q: string) => boolean;
  handler: Handler;
}

function makeMatcher(m: RegExp | string): (q: string) => boolean {
  return typeof m === "string" ? (q) => q.includes(m) : (q) => m.test(q);
}

export function createNeo4jMock(): Neo4jMockController {
  const runs: QueryRecord[] = [];
  const txHandlers: HandlerEntry[] = [];
  const sessionHandlers: HandlerEntry[] = [];
  let txCommitCount = 0;
  let txRollbackCount = 0;
  let nextCommitError: Error | null = null;

  function dispatch(handlers: HandlerEntry[], query: string, params: Record<string, unknown>): HandlerResult {
    for (const h of handlers) {
      if (h.match(query)) return h.handler({ query, params });
    }
    return none();
  }

  const txScope: ExecScope = {
    on(matcher, handler) { txHandlers.push({ match: makeMatcher(matcher), handler }); },
    get commitCount() { return txCommitCount; },
    get rollbackCount() { return txRollbackCount; },
    failNextCommit(err) { nextCommitError = err; },
  };

  const sessionScope: ExecScope = {
    on(matcher, handler) { sessionHandlers.push({ match: makeMatcher(matcher), handler }); },
    // Sessions don't have commit/rollback semantics in the driver mock; expose
    // 0 + no-op so consumers can use one ExecScope type without branching.
    get commitCount() { return 0; },
    get rollbackCount() { return 0; },
    failNextCommit() { /* no-op for session scope */ },
  };

  const module = {
    withSession: async <T>(fn: (session: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        run: async (query: string, params: Record<string, unknown>) => {
          runs.push({ query, params, via: "tx" });
          return dispatch(txHandlers, query, params);
        },
        commit: async () => {
          txCommitCount++;
          if (nextCommitError) {
            const err = nextCommitError;
            nextCommitError = null;
            throw err;
          }
        },
        rollback: async () => {
          txRollbackCount++;
        },
      };
      const session = {
        run: async (query: string, params: Record<string, unknown>) => {
          runs.push({ query, params, via: "session" });
          return dispatch(sessionHandlers, query, params);
        },
        beginTransaction: () => tx,
        close: async () => { /* no-op */ },
      };
      return fn(session);
    },
  };

  return {
    get runs() { return runs; },
    reset() {
      runs.length = 0;
      txHandlers.length = 0;
      sessionHandlers.length = 0;
      txCommitCount = 0;
      txRollbackCount = 0;
      nextCommitError = null;
    },
    tx: txScope,
    session: sessionScope,
    module,
  };
}
