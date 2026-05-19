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
 * Convert HTML to LLM-safe plain text per INV-0029-5.
 *
 * Pipeline:
 *   1. Strip HTML comments (`<!-- ... -->`).
 *   2. Remove every `DANGEROUS_TAGS` element (opening + content + closing).
 *   3. Strip every remaining HTML tag (`<...>`).
 *   4. Decode basic HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
 *      `&apos;`, `&#39;`, `&nbsp;` + numeric `&#NN;` / `&#xNN;`).
 *   5. Collapse whitespace to a single space; trim ends.
 *
 * The output is suitable for `wrapUntrusted()` consumption.
 */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";

  let out = html;

  // 1. Strip HTML comments (may contain `<script>` etc. as text).
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Remove dangerous-tag elements (case-insensitive, with attributes).
  for (const tag of DANGEROUS_TAGS) {
    const pattern = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi",
    );
    out = out.replace(pattern, "");
    // Self-closing dangerous tags: <iframe ... /> etc.
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/>`, "gi");
    out = out.replace(selfClosing, "");
    // Orphan opening tags with no closing (defensive — leftover): <script ...>
    const orphan = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    out = out.replace(orphan, "");
  }

  // 3. Strip remaining HTML tags.
  out = out.replace(/<[^>]+>/g, " ");

  // 4. Decode entities.
  out = decodeBasicEntities(out);

  // 5. Collapse whitespace; trim.
  out = out.replace(/[\s ]+/g, " ").trim();

  return out;
}
