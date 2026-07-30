/**
 * Draft a personalized cold-outreach email to a hiring manager / recruiter.
 * Pure prompt-building + parsing (unit-tested); the LLM call is behind an
 * injected `ChatClient`, and a deterministic template is the offline fallback
 * (used when no OpenAI key is configured). We never send anything — the user
 * copies the draft and sends it themselves.
 */
import type { ChatClient } from '@/server/enrich/types';

/** The sender's work-authorization framing, woven into every draft. */
export interface OutreachProfile {
  /** e.g. "F-1 (eligible for OPT)". */
  visa: string;
  /** e.g. "does not need sponsorship now but will require H-1B sponsorship in the future". */
  sponsorshipNote: string;
  /** e.g. "December 2026". */
  graduation: string;
  /** Optional signer name. */
  senderName?: string;
}

export const DEFAULT_PROFILE: OutreachProfile = {
  visa: 'F-1 (eligible for OPT)',
  sponsorshipNote:
    'does not need visa sponsorship now, but will require H-1B sponsorship in the future',
  graduation: 'December 2026',
};

export interface OutreachRequest {
  company: string;
  /** The role/title being pursued, if known. */
  role?: string;
  contactName?: string;
  contactTitle?: string;
  profile?: OutreachProfile;
}

export interface OutreachEmail {
  subject: string;
  body: string;
}

function profileOf(req: OutreachRequest): OutreachProfile {
  return req.profile ?? DEFAULT_PROFILE;
}

export const OUTREACH_SYSTEM_PROMPT = [
  'You draft short, genuine cold-outreach emails from a new-grad software engineer to a hiring manager or recruiter.',
  'Rules:',
  '- 110–160 words. Warm and specific, never generic or salesy. No buzzwords, no flattery filler.',
  '- Open by addressing the person by name if given; reference their company (and the role if given).',
  '- Naturally state the work-authorization facts provided (visa status, sponsorship timing, graduation) in ONE brief, matter-of-fact sentence — do not dwell on it or apologize.',
  '- End with a clear, low-pressure ask (a brief chat, advice, or being kept in mind for the role).',
  '- Plain text body, no markdown. Sign off with the sender name if given, else "[Your name]".',
  'Respond with ONLY a JSON object: {"subject": string, "body": string}. No prose, no code fences.',
].join('\n');

export function buildOutreachMessages(req: OutreachRequest): { system: string; user: string } {
  const p = profileOf(req);
  const facts = [
    `Company: ${req.company}`,
    req.role ? `Role of interest: ${req.role}` : 'Role of interest: (general SWE roles)',
    `Recipient: ${req.contactName ?? '(unknown — address generically, e.g. "Hi there")'}`,
    req.contactTitle ? `Recipient title: ${req.contactTitle}` : null,
    `Sender visa status: ${p.visa}`,
    `Sponsorship: ${p.sponsorshipNote}`,
    `Sender graduates: ${p.graduation}`,
    `Sender name: ${p.senderName ?? '(use "[Your name]")'}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { system: OUTREACH_SYSTEM_PROMPT, user: facts };
}

/** Parse the model's JSON reply, tolerating leading prose or ```json fences. */
export function parseOutreachEmail(raw: string): OutreachEmail {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in outreach draft');
  const parsed = JSON.parse(match[0]) as { subject?: unknown; body?: unknown };
  if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('Outreach draft missing subject/body');
  }
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

/** Deterministic fallback used when no LLM is configured. */
export function templateOutreachEmail(req: OutreachRequest): OutreachEmail {
  const p = profileOf(req);
  const greeting = req.contactName ? `Hi ${req.contactName},` : 'Hi there,';
  const roleLine = req.role
    ? `I'm reaching out about ${req.role} opportunities at ${req.company}.`
    : `I'm reaching out about software engineering opportunities at ${req.company}.`;
  const body = [
    greeting,
    '',
    `I'm a soon-to-be software engineer graduating in ${p.graduation}, and ${roleLine} Your team's work stood out to me and I'd love to learn more about it.`,
    '',
    `For transparency on work authorization: I'm on an ${p.visa} and ${p.sponsorshipNote}.`,
    '',
    'Would you be open to a quick 15-minute chat, or could you point me to the right person? Either way, thank you for your time.',
    '',
    'Best,',
    p.senderName ?? '[Your name]',
  ].join('\n');
  return { subject: `Aspiring SWE interested in ${req.company}`, body };
}

/** Draft via the LLM; callers fall back to the template when no client is available. */
export async function draftOutreachEmail(
  req: OutreachRequest,
  chat: ChatClient,
): Promise<OutreachEmail> {
  const raw = await chat.complete(buildOutreachMessages(req));
  return parseOutreachEmail(raw);
}
