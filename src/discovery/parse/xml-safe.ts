/**
 * xml-safe — INFRA-1B.2a
 * Singleton XMLParser with processEntities:false to block XXE attacks (DEC-018).
 *
 * Usage:
 *   import { RSS_PARSER } from "../../parse/xml-safe";
 *   const result = RSS_PARSER.parse(xmlText);
 *
 * Direct `new XMLParser()` calls without processEntities:false are prohibited
 * in src/discovery/ — always import this singleton instead.
 */

import { XMLParser } from "fast-xml-parser";

export const RSS_PARSER = new XMLParser({
  processEntities: false,     // XXE disabled (DEC-018 — must not be removed)
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  allowBooleanAttributes: true,
});
