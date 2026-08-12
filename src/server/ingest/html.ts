/**
 * Shared HTML→text + date helpers for ATS connectors (Greenhouse/Lever/Ashby),
 * whose job descriptions arrive as HTML.
 */

function decodeEntitiesOnce(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Decode to a fixed point so multi-encoded entities (`&amp;amp;`) fully resolve. */
function decodeEntities(s: string): string {
  let current = s;
  for (let i = 0; i < 5; i++) {
    const next = decodeEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Flatten (possibly entity-encoded) HTML to readable plain text.
 *
 * Decodes entities to a fixed point so markup like `&lt;p&gt;` becomes a real
 * tag, then strips only tag-shaped spans ONCE — a `<` must be followed by a
 * letter or `/` to count as a tag, so prose like "use a < b" survives. There is
 * no decode after stripping, so tags can't be re-created and destroyed. (Inline
 * pseudo-tags like `<String>` may still be dropped; fine for classifier input.)
 */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(html);
  const withBreaks = decoded
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n');
  const stripped = withBreaks.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  return stripped
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalize a date-ish value (ISO string or epoch ms) to a `Date`, or null.
 * Full precision is kept on purpose — the board renders "20m ago" / "5h ago",
 * so truncating to a calendar day here would throw that away irrecoverably.
 */
export function toPostedAt(value: string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
