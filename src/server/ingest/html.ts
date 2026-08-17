/**
 * Shared HTML→text + date helpers for ATS connectors (Greenhouse/Lever/Ashby),
 * whose job descriptions arrive as HTML.
 */

/**
 * Named entities beyond the structural ones. Kept small on purpose: these are
 * the accents and punctuation that actually turn up in company names and job
 * titles. Anything left undecoded survives into `jobs.company`, and from there
 * into `normalizeCompanyName`, where a stray `&` becomes " AND " and the
 * sponsor join key stops matching (`Nestlé` → `NESTL AND EACUTE`).
 */
const NAMED_ENTITIES: Record<string, string> = {
  apos: "'",
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ntilde: 'ñ',
  oslash: 'ø',
  aring: 'å',
  szlig: 'ß',
  reg: '®',
  copy: '©',
  trade: '™',
};

function decodeEntitiesOnce(s: string): string {
  return (
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&#x27;/gi, "'")
      .replace(/&nbsp;/g, ' ')
      // Numeric entities (`&#233;` / `&#xe9;`) — the common case for anything
      // non-ASCII in HTML-sourced company names.
      .replace(/&#(\d+);/g, (whole, dec: string) => codePointOr(whole, Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => codePointOr(whole, parseInt(hex, 16)))
      .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
  );
}

/** A malformed code point is left as-is rather than throwing mid-parse. */
function codePointOr(whole: string, code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
  try {
    return String.fromCodePoint(code);
  } catch {
    return whole;
  }
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
