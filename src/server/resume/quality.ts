/**
 * Deterministic resume linter — enforces the rubric in `rubric.ts` on any resume
 * text (markdown or LaTeX). Pure and offline; the tailoring generator (Inc 4)
 * will run this on its own output and iterate until it passes.
 */
import { BUZZWORDS, MAX_BULLETS, MIN_METRIC_RATIO, WEAK_VERBS, WORD_MAX, WORD_MIN } from './rubric';

export interface LintViolation {
  rule: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface KeywordCoverage {
  matched: string[];
  missing: string[];
  ratio: number;
}

export interface LintReport {
  wordCount: number;
  bulletCount: number;
  violations: LintViolation[];
  keywordCoverage?: KeywordCoverage;
  /** True when there are no error-severity violations. */
  ok: boolean;
}

export interface LintOptions {
  /** JD keywords to check coverage of (technical + soft). */
  jdKeywords?: string[];
  /** Warn if coverage ratio is below this. */
  minKeywordCoverage?: number;
  /**
   * The base résumé the tailored output must respect. When provided, the linter
   * enforces the template contract: section headings + header verbatim, and the
   * locked sections (default: PROJECTS) unchanged. Omit for free-form resumes.
   */
  base?: string;
  /** Section titles (case-insensitive) whose bodies must be preserved verbatim. */
  lockedSections?: string[];
}

/** Sections tailoring must never touch unless the caller overrides. */
export const DEFAULT_LOCKED_SECTIONS = ['projects'];

export interface ResumeSection {
  /** Heading as written, e.g. "TECHNICAL SKILLS". */
  title: string;
  /** Normalized title for matching (lowercased, whitespace-collapsed). */
  key: string;
  /** Raw text from after this heading up to the next section (or EOF). */
  body: string;
}

export interface ResumeStructure {
  /** Everything before the first \section — preamble + name/contact block. */
  header: string;
  sections: ResumeSection[];
}

/** Collapse whitespace + trim, for structural (whitespace-insensitive) compares. */
function normBlock(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function normKey(s: string): string {
  return normBlock(s).toLowerCase();
}

/** Drop LaTeX line comments (unescaped %) so commented-out headings don't register. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '%' && line[i - 1] !== '\\') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * From the index of an opening `{`, return the inner content and the index of
 * the matching `}` (brace-depth aware, skipping escaped `\{`/`\}`). Handles
 * nested-brace headings like `\section{\textbf{Skills}}`.
 */
function readBalancedBraces(text: string, open: number): { content: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++; // skip the escaped character
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { content: text.slice(open + 1, i), end: i };
  }
  return { content: text.slice(open + 1), end: text.length - 1 };
}

/** Split a LaTeX résumé into its header and \section blocks. */
export function extractSections(raw: string): ResumeStructure {
  const text = stripComments(raw);
  const cmd = /\\section\*?\s*\{/g;
  const heads: { cmdStart: number; bodyStart: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = cmd.exec(text)) !== null) {
    const braceOpen = m.index + m[0].length - 1; // index of the '{'
    const { content, end } = readBalancedBraces(text, braceOpen);
    heads.push({ cmdStart: m.index, bodyStart: end + 1, title: content.trim() });
    cmd.lastIndex = end + 1; // resume scanning past the (possibly nested) title
  }
  if (heads.length === 0) return { header: text, sections: [] };

  const header = text.slice(0, heads[0].cmdStart);
  const sections: ResumeSection[] = heads.map((h, i) => {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].cmdStart : text.length;
    return { title: h.title, key: normKey(h.title), body: text.slice(h.bodyStart, bodyEnd) };
  });
  return { header, sections };
}

// Bullets: markdown markers, LaTeX \item, or common resume-template item macros
// (Jake Gutierrez's \resumeItem{...}, moderncv \cvitem{}{}, etc.) so the
// verb/metric/punctuation checks aren't silently skipped on real templates.
const BULLET_RE =
  /^\s*(?:[-*•‣▪]\s+|\\item\b\s*|\\(?:resumeitem|resumesubitem|cvitem|cvlistitem|entry|achievement)\s*\{)\s*(.*\S)\s*$/i;

// A metric is a percentage, a money amount, a number with a meaningful unit, or
// a number introduced by by/to/from/under/over. Deliberately NOT a bare number
// (years like "2024" and IDs/phone numbers are not achievements).
const METRIC_RE = new RegExp(
  [
    String.raw`\d+(?:\.\d+)?\s?%`,
    String.raw`\$\s?\d`,
    String.raw`\b\d+(?:\.\d+)?\s?(?:k|m|b|x|ms|s|sec|secs|min|mins|hrs?|hours?|days?|weeks?|months?|users?|customers?|requests?|rps|qps|gb|tb|mb|lines?|teams?|people|engineers?|services?|apis?)\b`,
    String.raw`\b(?:by|to|from|under|over)\s+\d`,
  ].join('|'),
  'i',
);

/** Remove LaTeX commands/braces so analysis sees plain text. */
export function stripLatex(s: string): string {
  return s
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}$&#~^_\\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Lighter strip for keyword matching: drop LaTeX commands, braces, and stray
 * backslashes but KEEP tech symbols like # + . / (so "c#", "c++", ".net",
 * "ci/cd" survive — including LaTeX-escaped "C\#" which becomes "C#").
 */
function stripForMatch(s: string): string {
  return s
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  const tokens = stripLatex(text).match(/[A-Za-z0-9%$+.#-]+/g) ?? [];
  // Count only tokens with an alphanumeric char (excludes stray markers like "-").
  return tokens.filter((t) => /[A-Za-z0-9]/.test(t)).length;
}

/** Extract bullet contents (marker stripped, LaTeX flattened). */
export function extractBullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(BULLET_RE);
    if (m) {
      const content = stripLatex(m[1]).trim();
      if (content) out.push(content);
    }
  }
  return out;
}

function firstWord(bullet: string): string {
  const m = bullet.match(/[A-Za-z][A-Za-z-]*/);
  return m ? m[0].toLowerCase() : '';
}

const WEAK_SINGLE = new Set(WEAK_VERBS.filter((v) => !v.includes(' ')));
const WEAK_PHRASES = WEAK_VERBS.filter((v) => v.includes(' '));

/** Return the bystander verb a bullet starts with, or null. Token/phrase-aware. */
function startsWithWeakVerb(bullet: string): string | null {
  const lower = bullet.toLowerCase().trim();
  for (const phrase of WEAK_PHRASES) {
    if (lower === phrase || lower.startsWith(`${phrase} `)) return phrase;
  }
  const first = firstWord(bullet);
  return WEAK_SINGLE.has(first) ? first : null;
}

function hasMetric(bullet: string): boolean {
  return METRIC_RE.test(bullet);
}

function endsWithPeriod(bullet: string): boolean {
  return /\.$/.test(bullet.trim());
}

/** Escape a keyword for use in a whole-word regex. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (boundary-aware) presence, so "go" doesn't match "category". */
function containsKeyword(hay: string, keyword: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, 'i').test(hay);
}

function computeCoverage(text: string, keywords: string[]): KeywordCoverage {
  const hay = stripForMatch(text).toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    if (containsKeyword(hay, needle)) matched.push(needle);
    else missing.push(needle);
  }
  const total = matched.length + missing.length;
  return { matched, missing, ratio: total === 0 ? 1 : matched.length / total };
}

export function lintResume(text: string, opts: LintOptions = {}): LintReport {
  const violations: LintViolation[] = [];
  const wordCount = countWords(text);
  const bullets = extractBullets(text);

  if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
    violations.push({
      rule: 'word-count',
      severity: 'error',
      message: `Resume is ${wordCount} words; target ${WORD_MIN}–${WORD_MAX}.`,
    });
  }

  // Bullet count is what actually decides whether the résumé stays on one page:
  // every \item costs its own leading and usually wraps to 2–3 lines, so a draft
  // can sit inside the word band and still spill onto a second page.
  if (bullets.length > MAX_BULLETS) {
    violations.push({
      rule: 'bullet-count',
      severity: 'error',
      message: `Resume has ${bullets.length} bullets; at most ${MAX_BULLETS} fit on one page. Cut the weakest, don't shorten them.`,
    });
  }

  // Substantial text but no recognizable bullets => the verb/metric/punctuation
  // checks below are skipped. Warn so a custom-macro template isn't silently
  // rubber-stamped as clean.
  if (bullets.length === 0 && wordCount >= 100) {
    violations.push({
      rule: 'no-bullets',
      severity: 'warn',
      message:
        'No bullets detected — verb/metric/punctuation checks skipped (custom LaTeX item macro?).',
    });
  }

  let metricBullets = 0;
  let periodBullets = 0;
  for (const bullet of bullets) {
    // Only penalize genuine bystander starts. We don't require membership in a
    // closed "strong verb" list (that thrashes the generator on valid verbs);
    // strong verbs are guidance in the rubric prompt instead.
    const weak = startsWithWeakVerb(bullet);
    if (weak) {
      violations.push({
        rule: 'weak-verb',
        severity: 'error',
        message: `Bullet starts with bystander verb "${weak}": "${bullet.slice(0, 60)}"`,
      });
    }
    if (hasMetric(bullet)) metricBullets++;
    if (endsWithPeriod(bullet)) periodBullets++;
  }

  if (bullets.length > 0) {
    if (metricBullets / bullets.length < MIN_METRIC_RATIO) {
      violations.push({
        rule: 'metrics',
        severity: 'warn',
        message: `Only ${metricBullets}/${bullets.length} bullets have a metric; aim for at least half.`,
      });
    }
    // Punctuation should be all-or-nothing across bullets.
    if (periodBullets !== 0 && periodBullets !== bullets.length) {
      violations.push({
        rule: 'punctuation',
        severity: 'error',
        message: `Inconsistent bullet punctuation: ${periodBullets}/${bullets.length} end with a period.`,
      });
    }

    // Verb variety: reusing the same opening verb reads as templated. Warn (not
    // error) so it nudges the generator without thrashing on valid repeats.
    const leadCounts = new Map<string, number>();
    for (const b of bullets) {
      const v = firstWord(b);
      if (v) leadCounts.set(v, (leadCounts.get(v) ?? 0) + 1);
    }
    const repeated = [...leadCounts.entries()].filter(([, n]) => n > 1).map(([v]) => v);
    if (repeated.length > 0) {
      violations.push({
        rule: 'verb-variety',
        severity: 'warn',
        message: `Repeated opening verb(s): ${repeated.join(', ')}. Vary the lead verb across bullets.`,
      });
    }
  }

  const lowerText = stripLatex(text).toLowerCase();
  for (const word of BUZZWORDS) {
    if (containsKeyword(lowerText, word)) {
      violations.push({
        rule: 'buzzword',
        severity: 'warn',
        message: `Contains fluff/cliche: "${word}".`,
      });
    }
  }

  // Template contract: when a base résumé is given, headings + header + the
  // locked sections must survive tailoring untouched.
  if (opts.base !== undefined) {
    const base = extractSections(opts.base);
    if (base.sections.length === 0) {
      // No headings to anchor on — treating the whole doc as a locked header
      // would flag every legitimate edit, so skip the checks and surface why.
      violations.push({
        rule: 'template-structure',
        severity: 'warn',
        message: 'Base résumé has no \\section headings; structural lock checks skipped.',
      });
    } else {
      const tailored = extractSections(text);
      // PROJECTS is always locked; callers can only add to the set, never unlock it.
      const lockedKeys = new Set(
        [...DEFAULT_LOCKED_SECTIONS, ...(opts.lockedSections ?? [])].map(normKey),
      );

      const baseKeys = base.sections.map((s) => s.key);
      const tailoredKeys = tailored.sections.map((s) => s.key);
      const sameStructure =
        baseKeys.length === tailoredKeys.length && baseKeys.every((k, i) => k === tailoredKeys[i]);
      if (!sameStructure) {
        violations.push({
          rule: 'section-structure',
          severity: 'error',
          message: `Section headings must match the template. Expected [${base.sections
            .map((s) => s.title)
            .join(', ')}], got [${tailored.sections.map((s) => s.title).join(', ')}].`,
        });
      }

      if (normBlock(base.header) !== normBlock(tailored.header)) {
        violations.push({
          rule: 'header-changed',
          severity: 'error',
          message: 'Header (name, contact, preamble) must be preserved verbatim.',
        });
      }

      // Keyed by normalized title; duplicate titles in a one-pager are not
      // expected — if present, only the last same-titled section is compared.
      const tailoredByKey = new Map(tailored.sections.map((s) => [s.key, s]));
      for (const s of base.sections) {
        if (!lockedKeys.has(s.key)) continue;
        const t = tailoredByKey.get(s.key);
        if (!t || normBlock(t.body) !== normBlock(s.body)) {
          violations.push({
            rule: 'locked-section',
            severity: 'error',
            message: `Section "${s.title}" is locked and must be preserved verbatim.`,
          });
        }
      }
    }
  }

  let keywordCoverage: KeywordCoverage | undefined;
  if (opts.jdKeywords && opts.jdKeywords.length > 0) {
    keywordCoverage = computeCoverage(text, opts.jdKeywords);
    const min = opts.minKeywordCoverage ?? 0.6;
    if (keywordCoverage.ratio < min) {
      violations.push({
        rule: 'keyword-coverage',
        severity: 'warn',
        message: `Covers ${(keywordCoverage.ratio * 100).toFixed(0)}% of JD keywords; missing: ${keywordCoverage.missing.join(', ')}.`,
      });
    }
  }

  return {
    wordCount,
    bulletCount: bullets.length,
    violations,
    keywordCoverage,
    ok: !violations.some((v) => v.severity === 'error'),
  };
}
