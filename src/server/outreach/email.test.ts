import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import {
  buildOutreachMessages,
  draftOutreachEmail,
  parseOutreachEmail,
  templateOutreachEmail,
} from './email';

const req = {
  company: 'Stripe',
  role: 'Backend Engineer',
  contactName: 'Dana Lee',
  contactTitle: 'Engineering Manager',
};

describe('buildOutreachMessages', () => {
  it('includes the recipient, company/role, and the work-auth facts', () => {
    const { system, user } = buildOutreachMessages(req);
    expect(system).toMatch(/JSON object/i);
    expect(user).toContain('Stripe');
    expect(user).toContain('Backend Engineer');
    expect(user).toContain('Dana Lee');
    expect(user).toContain('Engineering Manager');
    expect(user).toMatch(/F-1/);
    expect(user).toMatch(/sponsorship/i);
    expect(user).toMatch(/December 2026/);
  });

  it('includes the sender fit strengths when provided', () => {
    const { user } = buildOutreachMessages({ company: 'Ramp', fitSkills: ['go', 'kafka'] });
    expect(user).toContain('relevant strengths');
    expect(user).toContain('go, kafka');
  });

  it('omits the strengths line when there are none', () => {
    const { user } = buildOutreachMessages({ company: 'Ramp' });
    expect(user).not.toContain('relevant strengths');
  });

  it('handles a missing contact and role gracefully', () => {
    const { user } = buildOutreachMessages({ company: 'Ramp' });
    expect(user).toContain('Ramp');
    expect(user).toMatch(/general SWE roles/i);
    expect(user).toMatch(/unknown/i);
  });

  it('honors a custom profile', () => {
    const { user } = buildOutreachMessages({
      company: 'Ramp',
      profile: {
        visa: 'H-1B',
        sponsorshipNote: 'needs transfer',
        graduation: 'May 2025',
        senderName: 'Sam',
      },
    });
    expect(user).toContain('H-1B');
    expect(user).toContain('May 2025');
    expect(user).toContain('Sam');
  });
});

describe('parseOutreachEmail', () => {
  it('parses a clean JSON object', () => {
    expect(parseOutreachEmail('{"subject":"Hi","body":"Hello there"}')).toEqual({
      subject: 'Hi',
      body: 'Hello there',
    });
  });

  it('tolerates code fences / leading prose and trims', () => {
    const raw = 'Sure!\n```json\n{ "subject": " S ", "body": " B " }\n```';
    expect(parseOutreachEmail(raw)).toEqual({ subject: 'S', body: 'B' });
  });

  it('throws on missing fields or no JSON', () => {
    expect(() => parseOutreachEmail('{"subject":"only"}')).toThrow();
    expect(() => parseOutreachEmail('no json here')).toThrow();
  });
});

describe('templateOutreachEmail', () => {
  it('produces a usable draft with the key facts', () => {
    const email = templateOutreachEmail(req);
    expect(email.subject).toContain('Stripe');
    expect(email.body).toContain('Hi Dana Lee,');
    expect(email.body).toContain('Backend Engineer');
    expect(email.body).toMatch(/F-1/);
    expect(email.body).toMatch(/December 2026/);
    expect(email.body).toContain('[Your name]');
  });

  it('weaves fit strengths into the template body when provided', () => {
    const email = templateOutreachEmail({ company: 'Ramp', fitSkills: ['go', 'kafka'] });
    expect(email.body).toContain('go, kafka');
    expect(email.body.toLowerCase()).toContain('strong fit');
  });

  it('falls back to a generic greeting and role when unknown', () => {
    const email = templateOutreachEmail({ company: 'Ramp' });
    expect(email.body).toContain('Hi there,');
    expect(email.body).toMatch(/software engineering opportunities at Ramp/);
  });
});

describe('draftOutreachEmail', () => {
  it('sends the prompt to the injected chat client and parses the reply', async () => {
    const chat: ChatClient = {
      complete: async ({ system, user }) => {
        expect(system).toMatch(/outreach/i);
        expect(user).toContain('Stripe');
        return '{"subject":"Quick hello","body":"Hi Dana…"}';
      },
    };
    expect(await draftOutreachEmail(req, chat)).toEqual({
      subject: 'Quick hello',
      body: 'Hi Dana…',
    });
  });
});
