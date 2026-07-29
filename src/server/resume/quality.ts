/**
 * Deterministic resume linter — enforces the rubric in `rubric.ts` on any resume
 * text (markdown or LaTeX). Pure and offline; the tailoring generator (Inc 4)
 * will run this on its own output and iterate until it passes.
 */
import {
  BUZZWORDS,
  MIN_METRIC_RATIO,
  STRONG_VERBS,
  WEAK_VERBS,
  WORD_MAX,
  WORD_MIN,
} from './rubric';

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
}

const BULLET_RE = /^\s*(?:[-*•‣▪]|\\item)\s+(.*\S)\s*$/;
const METRIC_RE =
  /(\d+(?:\.\d+)?\s?%|\$\s?\d|\b\d+(?:\.\d+)?\s?(?:k|m|b|x|ms|s|sec|secs|min|mins|hrs?|hours?|days?|users?|customers?|requests?|rps|qps|gb|tb|lines?|teams?)\b|\bby\s+\d|\b\d{2,}\b)/i;

/** Remove LaTeX commands/braces so analysis sees plain text. */
function stripLatex(s: string): string {
  return s
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}$&#~^_\\]/g, ' ')
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

function startsWithWeakVerb(bullet: string): string | null {
  const lower = bullet.toLowerCase();
  return WEAK_VERBS.find((v) => lower.startsWith(v)) ?? null;
}

function hasMetric(bullet: string): boolean {
  return METRIC_RE.test(bullet);
}

function endsWithPeriod(bullet: string): boolean {
  return /\.$/.test(bullet.trim());
}

function computeCoverage(text: string, keywords: string[]): KeywordCoverage {
  const hay = stripLatex(text).toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    if (hay.includes(needle)) matched.push(needle);
    else missing.push(needle);
  }
  const total = matched.length + missing.length;
  return { matched, missing, ratio: total === 0 ? 1 : matched.length / total };
}

const STRONG = new Set(STRONG_VERBS);

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

  let metricBullets = 0;
  let periodBullets = 0;
  for (const bullet of bullets) {
    const weak = startsWithWeakVerb(bullet);
    if (weak) {
      violations.push({
        rule: 'weak-verb',
        severity: 'error',
        message: `Bullet starts with bystander verb "${weak}": "${bullet.slice(0, 60)}"`,
      });
    } else if (!STRONG.has(firstWord(bullet))) {
      violations.push({
        rule: 'verb-strength',
        severity: 'warn',
        message: `Bullet may not start with a strong action verb: "${bullet.slice(0, 60)}"`,
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
  }

  const lowerText = stripLatex(text).toLowerCase();
  for (const word of BUZZWORDS) {
    if (lowerText.includes(word)) {
      violations.push({
        rule: 'buzzword',
        severity: 'warn',
        message: `Contains fluff/cliche: "${word}".`,
      });
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
