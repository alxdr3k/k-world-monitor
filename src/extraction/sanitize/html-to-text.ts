/**
 * HTML → plain text sanitizer for LLM input (ADR-0029 INV-0029-5).
 *
 * Removes `<script>` / `<style>` / `<noscript>` / `<iframe>` / `<object>` /
 * `<embed>` tags AND their content (these can carry prompt-injection
 * payload that would otherwise reach the LLM intact). Strips all
 * remaining HTML tags and decodes basic HTML entities.
 *
 * **Not a full HTML parser** — intentional. The output is fed to an
 * LLM as untrusted data; structural fidelity is irrelevant. Defensive
 * regex-based sanitization is preferred over a DOM parser to avoid
 * parser-level injection vectors.
 *
 * Operator decision: EXTR-1A.0 prerequisite slice for EXTR-1A.1
 * extractor router (PRE-0029-2).
 */

/**
 * Tag names whose entire element (opening tag + content + closing tag)
 * must be removed before LLM input — per INV-0029-5.
 */
export const DANGEROUS_TAGS: readonly string[] = [
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
];

/**
 * HTML named character reference replacements. Per HTML5 spec, named
 * references are case-SENSITIVE (`&lt;` and `&LT;` are different
 * entities), but BOTH lowercase and uppercase forms exist for the
 * basic entities. PR #97 codex round 2 P2 — earlier lowercase-only
 * map let `&LT;script&GT;...` bypass entity decode → bypass DANGEROUS
 * pass → reach LLM as encoded payload.
 *
 * Coverage: lowercase + uppercase + selected camelCase (`&NewLine;` /
 * `&Tab;` etc. exist but are unlikely in adversarial payloads). Stick
 * to the documented HTML5 case variants for the basic entities.
 */
const HTML_ENTITY_MAP: Record<string, string> = {
  // Lowercase form (most common in real-world HTML).
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  // Uppercase form (HTML5 spec).
  "&AMP;": "&",
  "&LT;": "<",
  "&GT;": ">",
  "&QUOT;": '"',
  "&NBSP;": " ",
  // Numeric apostrophe (apostrophe is `&apos;` since HTML5; pre-HTML5
  // used `&#39;` exclusively).
  "&#39;": "'",
};

function decodeBasicEntities(text: string): string {
  let out = text;
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    out = out.replaceAll(entity, replacement);
  }
  // Numeric entities: &#NN; (decimal). Case-insensitive on `x` prefix
  // (HTML allows `&#x` or `&#X`).
  out = out.replace(/&#(\d+);/g, (_, code: string) => {
    const n = Number(code);
    return Number.isInteger(n) && n >= 0 && n < 0x110000
      ? String.fromCodePoint(n)
      : "";
  });
  out = out.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code: string) => {
    const n = parseInt(code, 16);
    return Number.isInteger(n) && n >= 0 && n < 0x110000
      ? String.fromCodePoint(n)
      : "";
  });
  return out;
}

/**
 * Run a single DANGEROUS_TAGS removal pass. Removes (a) full elements
 * (open + content + close), (b) self-closing forms (`<iframe ... />`),
 * and (c) orphan unclosed opening tags — for orphan, the opener AND
 * everything from that opener to EOF is dropped fail-closed (PR #97
 * codex round 1 P2 — earlier behavior left the body text in place,
 * leaking payload to the LLM).
 */
function removeDangerousTags(input: string): string {
  let out = input;
  for (const tag of DANGEROUS_TAGS) {
    // Full element with content (closed).
    const closed = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi",
    );
    out = out.replace(closed, "");
    // Self-closing dangerous tags.
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/>`, "gi");
    out = out.replace(selfClosing, "");
    // Orphan opening with no matching closer — drop opener AND
    // remainder of the input fail-closed (PR #97 codex P2 —
    // INV-0029-5 requires these tags AND their contents to be removed).
    const orphan = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*`, "i");
    out = out.replace(orphan, "");
  }
  return out;
}

/**
 * Quote-aware HTML tag stripper regex (PR #97 codex round 2 P2 —
 * earlier `<[^>]+>` regex stopped at the first `>` inside attribute
 * values, leaking the rest of the attribute + following content to
 * the LLM).
 *
 * Matches: `<` + optional `/` + alpha char (HTML tag name) + tag body
 * where double / single quoted attribute values are treated as opaque
 * blocks that may contain `>` chars without ending the tag.
 *
 * Does NOT match `<` followed by non-alpha (e.g. `1 < 2`) so decoded
 * user-content arithmetic / comparison expressions are preserved.
 */
const QUOTE_AWARE_TAG_STRIP =
  /<\/?[a-zA-Z][^"'>]*(?:(?:"[^"]*"|'[^']*')[^"'>]*)*>/g;

/**
 * Convert HTML to LLM-safe plain text per INV-0029-5.
 *
 * Pipeline (PR #97 codex review round 2 — entity decode + dual generic
 * strip + dual DANGEROUS pass for full coverage):
 *   1. Strip HTML comments (`<!-- ... -->`).
 *   2. **First DANGEROUS_TAGS removal pass** — catches raw `<script>` /
 *      `<style>` / etc. in the source (closed / self-closing / orphan).
 *   3. **First generic tag strip** — quote-aware regex removes
 *      remaining real HTML tags (incl. tags with `>` inside quoted
 *      attribute values).
 *   4. **Decode HTML entities** (lowercase + uppercase named refs +
 *      numeric decimal / hex; PR #97 codex round 2 P2 — uppercase
 *      `&LT;` `&GT;` etc.) — surfaces entity-encoded HTML tags like
 *      `&lt;script&gt;...` as literal `<script>...`.
 *   5. **Second DANGEROUS_TAGS removal pass** — catches now-decoded
 *      entity-encoded dangerous tags.
 *   6. **Second generic tag strip** (quote-aware) — catches now-decoded
 *      entity-encoded ordinary tags like decoded `<p>Hello</p>` or
 *      `<img alt="...">Caption` (PR #97 codex round 2 P2). The regex
 *      requires `<` to be followed by alpha / `/alpha`, so legitimate
 *      decoded user text like `1 < 2 > 0` is preserved.
 *   7. Collapse whitespace to a single space; trim ends.
 *
 * Orphan unclosed dangerous tags drop the remainder of the input
 * fail-closed at steps 2 / 5 — no payload leak.
 *
 * The output is suitable for `wrapUntrusted()` consumption.
 */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";

  let out = html;

  // 1. Strip HTML comments (may contain `<script>` etc. as text),
  //    DOCTYPE / CDATA declarations, and XML processing instructions.
  //    These all start with `<!` or `<?` which the quote-aware tag
  //    stripper does NOT match (it requires alpha after `<`).
  out = out.replace(/<!--[\s\S]*?-->/g, "");  // comments
  out = out.replace(/<![^>]*>/g, "");          // DOCTYPE / CDATA
  out = out.replace(/<\?[\s\S]*?\?>/g, "");    // processing instructions (XML / PHP-style)

  // 2. First DANGEROUS_TAGS removal pass (raw source).
  out = removeDangerousTags(out);

  // 3. First quote-aware generic tag strip — real HTML markup.
  out = out.replace(QUOTE_AWARE_TAG_STRIP, " ");

  // 4. Decode entities — may surface entity-encoded HTML tags.
  out = decodeBasicEntities(out);

  // 5. Second DANGEROUS_TAGS pass — catches now-decoded entity payloads.
  out = removeDangerousTags(out);

  // 6. Second quote-aware generic tag strip — catches now-decoded
  //    ordinary tags (e.g. `<p>` / `<img onerror=...>`). The quote-
  //    aware regex requires `<` + alpha/`/alpha` so legitimate decoded
  //    user content like `1 < 2 > 0` is preserved.
  out = out.replace(QUOTE_AWARE_TAG_STRIP, " ");

  // 7. Collapse whitespace; trim.
  out = out.replace(/[\s ]+/g, " ").trim();

  return out;
}
