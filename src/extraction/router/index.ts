/**
 * Public entry point for the extractor router (EXTR-1A.1).
 *
 * Re-exports the canonical types + registry + router for callers
 * that consume the entire surface as a single module.
 */

export {
  isSourceType,
  SOURCE_TYPE,
  type Extractor,
  type ExtractorInput,
  type ExtractorOutput,
  type SourceType,
} from "./types";

export {
  ExtractorAlreadyRegisteredError,
  ExtractorNotRegisteredError,
  ExtractorRegistry,
  InvalidSourceTypeError,
} from "./registry";

export { routeAndExtract } from "./router";
