/**
 * Extractor registry — source-type → `Extractor` lookup (EXTR-1A.1).
 *
 * Per AC-021 (NFR-007 maintainability), adding a new source type is a
 * register() + dry-run test, with no edits to existing branches. The
 * registry is fail-closed: unregistered source types throw
 * `ExtractorNotRegisteredError` rather than silently falling back.
 *
 * Construction is dependency-injection style — callers build the
 * registry once at process startup and pass it to the router. Tests
 * build fresh registries with mock extractors per test case.
 */

import {
  isSourceType,
  type Extractor,
  type SourceType,
} from "./types";

/**
 * Thrown when `register()` is called twice for the same `sourceType`.
 * Prevents accidental override / double-wiring at boot.
 */
export class ExtractorAlreadyRegisteredError extends Error {
  constructor(public readonly sourceType: SourceType) {
    super(`Extractor already registered for sourceType=${sourceType}`);
    this.name = "ExtractorAlreadyRegisteredError";
  }
}

/**
 * Thrown by `get()` when no extractor is registered for the requested
 * `sourceType`. Router callers catch this to surface fail-closed
 * routing failure to the caller (no silent default extractor).
 */
export class ExtractorNotRegisteredError extends Error {
  constructor(public readonly sourceType: string) {
    super(`No extractor registered for sourceType=${sourceType}`);
    this.name = "ExtractorNotRegisteredError";
  }
}

/**
 * Thrown when the `extractor.sourceType` does not pass `isSourceType()`.
 * Defends register() against off-canonical-enum values (typos,
 * external string sources).
 */
export class InvalidSourceTypeError extends Error {
  constructor(public readonly sourceType: unknown) {
    super(
      `Invalid sourceType: ${String(sourceType)} (expected one of canonical SOURCE_TYPE)`,
    );
    this.name = "InvalidSourceTypeError";
  }
}

export class ExtractorRegistry {
  private readonly entries = new Map<SourceType, Extractor>();

  /**
   * Register one extractor implementation. Throws on:
   *   - off-canonical `sourceType` (InvalidSourceTypeError)
   *   - duplicate registration (ExtractorAlreadyRegisteredError)
   */
  register(extractor: Extractor): void {
    if (!isSourceType(extractor.sourceType)) {
      throw new InvalidSourceTypeError(extractor.sourceType);
    }
    if (this.entries.has(extractor.sourceType)) {
      throw new ExtractorAlreadyRegisteredError(extractor.sourceType);
    }
    this.entries.set(extractor.sourceType, extractor);
  }

  /**
   * Look up the extractor for the given canonical source type. Throws
   * `ExtractorNotRegisteredError` if the slot is empty — fail-closed
   * per AC-009 (no silent default branch).
   */
  get(sourceType: SourceType): Extractor {
    const ext = this.entries.get(sourceType);
    if (!ext) throw new ExtractorNotRegisteredError(sourceType);
    return ext;
  }

  /**
   * Read-only snapshot of currently registered source types. Order
   * matches `SOURCE_TYPE` declaration to make test assertions
   * deterministic.
   */
  registeredSourceTypes(): readonly SourceType[] {
    return Array.from(this.entries.keys());
  }
}
