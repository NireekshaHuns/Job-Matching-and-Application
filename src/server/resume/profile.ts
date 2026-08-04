/**
 * Candidate profile facts — the fixed identity that heads every generated resume
 * (name, contacts, links, cert) plus the real metrics/stack the tailoring engine
 * should prefer before inventing anything. Stored in the `resume_profile` table
 * (single row); when unset, `DEFAULT_PROFILE_FACTS` seeds sensible values so the
 * Studio works out of the box. Pure — no DB/LLM here.
 */

export interface ResumeProfileFacts {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  /** Free text, e.g. "December 2026". */
  gradDate: string | null;
  certText: string | null;
  certUrl: string | null;
  /** Real, verified metrics the engine prefers before inventing any number. */
  knownMetrics: string | null;
  /** Confirmed stack per role, so invented detail stays consistent with reality. */
  stackNotes: string | null;
}

/**
 * Seed facts (from the owner's own résumé research). Used as fallbacks when the
 * `resume_profile` row is empty, and to pre-fill the Settings editor. The header
 * fields left null (phone / profile URLs) are the ones the owner still needs to
 * enter — everything else is safe to use immediately.
 */
export const DEFAULT_PROFILE_FACTS: ResumeProfileFacts = {
  name: 'Nireeksha Huns',
  email: 'huns.n@northeastern.edu',
  phone: null,
  linkedinUrl: null,
  githubUrl: null,
  gradDate: 'December 2026',
  certText: 'AWS Certified Solutions Architect – Associate',
  certUrl: null,
  knownMetrics: [
    'LSEG: verification latency 2 min → 500 ms; screening throughput +40%; 2.5M+ PostgreSQL records;',
    'blocked 100,000+ malicious requests/day; Kafka 500,000+ daily financial events at sub-200 ms latency;',
    'fixed 15+ production defects per release; 4M+ watchlist records.',
    'Riskcast: 50,000+ daily transactions; 75+ enterprise clients; RAG search over 10,000+ construction',
    'risk records with −60% manual-lookup time; query latency 450 ms → under 150 ms.',
  ].join(' '),
  stackNotes: [
    'Riskcast Solutions — Software Engineer, New York (Jul 2025 – Jan 2026): React, TypeScript, JavaScript (ES6+),',
    'Node.js, NestJS, Vite, Redux, Zustand, PostgreSQL, Docker, AWS (Lambda, API Gateway), Terraform (IaC from',
    'scratch), OAuth, REST + GraphQL, LangChain + OpenAI + Claude (RAG / agentic search in the UI), Jest, React',
    'Testing Library; monolith → microservices. Domain: construction risk.',
    'LSEG — Software Engineer, Bangalore (Jan 2022 – Aug 2024): Java, Spring Boot, Python, AWS (SQS, SNS, WAF,',
    'Lambda), Redis, Kafka, Kubernetes, PostgreSQL, JWT + RBAC, event-driven pipelines, GitLab CI/CD, JUnit,',
    'Mockito, SonarQube; also React + TypeScript compliance UIs, React Query, Redux, Zustand, Jest. Domain:',
    'World-Check KYC / compliance. Collaborated with PMs, POs, and cross-country teams.',
    'Project — Job Matching & Application Platform: Next.js, TypeScript, tRPC, Drizzle ORM, PostgreSQL/pgvector,',
    'Inngest, Playwright, LLM-drafted outreach, drag-and-drop Kanban tracker',
    '(https://github.com/NireekshaHuns/Job-Matching-and-Application).',
    'Do NOT claim Go, or monorepo tools (Turborepo/Nx), unless explicitly confirmed.',
  ].join(' '),
};

/** Merge a stored (possibly partial) profile over the seed defaults. */
export function withProfileDefaults(row: Partial<ResumeProfileFacts> | null): ResumeProfileFacts {
  const pick = <K extends keyof ResumeProfileFacts>(k: K): ResumeProfileFacts[K] => {
    const v = row?.[k];
    return v == null || v === '' ? DEFAULT_PROFILE_FACTS[k] : v;
  };
  return {
    name: pick('name'),
    email: pick('email'),
    phone: pick('phone'),
    linkedinUrl: pick('linkedinUrl'),
    githubUrl: pick('githubUrl'),
    gradDate: pick('gradDate'),
    certText: pick('certText'),
    certUrl: pick('certUrl'),
    knownMetrics: pick('knownMetrics'),
    stackNotes: pick('stackNotes'),
  };
}

/** A "field: value" line, omitted entirely when the value is blank. */
function line(label: string, value: string | null): string[] {
  return value && value.trim() ? [`${label}: ${value.trim()}`] : [];
}

/**
 * Render the profile as a prompt block the tailoring model treats as fixed
 * ground truth (identity/contacts) plus preferred real material (metrics/stack).
 */
export function formatProfileForPrompt(p: ResumeProfileFacts): string {
  const contacts = [
    ...line('Email', p.email),
    ...line('Phone', p.phone),
    ...line('LinkedIn', p.linkedinUrl),
    ...line('GitHub', p.githubUrl),
  ].join(' | ');

  return [
    'CANDIDATE (fixed facts — never change name, employers, titles, dates, or degree):',
    ...line('Name', p.name),
    contacts ? `Contact line: ${contacts}` : '',
    ...line('Graduation', p.gradDate),
    ...line('Certification', [p.certText, p.certUrl].filter(Boolean).join(' — ')),
    '',
    'REAL, VERIFIED METRICS (prefer these before inventing any number):',
    p.knownMetrics?.trim() || '(none provided)',
    '',
    'CONFIRMED STACK / DOMAIN (keep invented detail consistent with this):',
    p.stackNotes?.trim() || '(none provided)',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
