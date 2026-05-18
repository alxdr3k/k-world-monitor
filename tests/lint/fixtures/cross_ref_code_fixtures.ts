/**
 * Fixtures for tests/lint/cross_ref_code_test.ts (Cycle 14 follow-up: Codex
 * PR #72 round 1 P2 findings).
 *
 * Each export below pins one declaration / re-export form the validator must
 * recognize. Do NOT delete entries — they are referenced by name from
 * cross_ref_code_test.ts. Adding new forms is fine.
 *
 * Intentionally lightweight (no side effects, no runtime imports of other
 * modules) so this file is safe to load without bootstrapping the full app.
 */

// 1. Plain declarations
export function plainFunction(): void {}
export async function plainAsync(): Promise<void> {}
export function* plainGenerator(): Generator<number> {
  yield 1;
}
export async function* plainAsyncGenerator(): AsyncGenerator<number> {
  yield 1;
}
export const plainConst = 1;
export class PlainClass {}
export interface PlainInterface {
  x: number;
}
export type PlainType = number;
export enum PlainEnum {
  A,
}

// 2. Default async declaration with a name — `defaultAsyncDecl` should still
//    validate as a cross_ref target since enforcement code routes via the
//    declared name (not the `default` re-export downstream).
export default async function defaultAsyncDecl(): Promise<void> {}

// 3. Aliased re-export — the importable name from this module is the alias
//    (`renamedExternal`). The internal source name (`internalSecret`) is
//    NOT importable from outside this module and must NOT validate as a
//    cross_ref target.
const internalSecret = 1;
export { internalSecret as renamedExternal };
