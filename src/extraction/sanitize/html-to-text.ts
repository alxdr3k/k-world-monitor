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

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeBasicEntities(text: string): string {
  let out = text;
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    out = out.replaceAll(entity, replacement);
  }
  // Numeric entities: &#NN; (decimal) and &#xNN; (hex)
  out = out.replace(/&#(\d+);/g, (_, code: string) => {
    const n = Number(code);
    return Number.isInteger(n) && n >= 0 && n < 0x110000
      ? String.fromCodePoint(n)
      : "";
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => {
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
 * Convert HTML to LLM-safe plain text per INV-0029-5.
 *
 * Pipeline (PR #97 codex review round 1 — re-ordered for entity defense):
 *   1. Strip HTML comments (`<!-- ... -->`).
 *   2. **First DANGEROUS_TAGS removal pass** — catches raw `<script>` /
 *      `<style>` / etc. in the source.
 *   3. Strip every remaining HTML tag (`<...>`) — done BEFORE entity
 *      decode so that decoded user-content `<` / `>` characters
 *      (e.g. `1 &lt; 2`) are not later stripped as "fake tags".
 *   4. **Decode HTML entities** (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
 *      `&apos;`, `&#39;`, `&nbsp;` + numeric `&#NN;` / `&#xNN;`) —
 *      surfaces entity-encoded dangerous tags like
 *      `&lt;script&gt;payload&lt;/script&gt;` as literal `<script>...`.
 *   5. **Second DANGEROUS_TAGS removal pass** — catches the now-decoded
 *      entity-encoded dangerous tags (PR #97 codex round 1 P2). Does
 *      NOT do generic tag-stripping (would consume legitimate decoded
 *      `<` characters in user content).
 *   6. Collapse whitespace to a single space; trim ends.
 *
 * Orphan unclosed dangerous tags drop the remainder of the input
 * fail-closed at steps 2 / 5 — no payload leak.
 *
 * The output is suitable for `wrapUntrusted()` consumption.
 */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";

  let out = html;

  // 1. Strip HTML comments (may contain `<script>` etc. as text).
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // 2. First DANGEROUS_TAGS removal pass (raw source).
  out = removeDangerousTags(out);

  // 3. Strip remaining real HTML tags BEFORE entity decode — decoded
  //    user-content `<` / `>` (e.g. `1 < 2`) must not be eaten by the
  //    tag stripper.
  out = out.replace(/<[^>]+>/g, " ");

  // 4. Decode entities — may surface entity-encoded dangerous tags.
  out = decodeBasicEntities(out);

  // 5. Second DANGEROUS_TAGS pass — catches now-decoded entity
  //    payloads. NO generic tag stripping after this point (would
  //    consume legitimate decoded `<` / `>` user content).
  out = removeDangerousTags(out);

  // 6. Collapse whitespace; trim.
  out = out.replace(/[\s ]+/g, " ").trim();

  return out;
}
