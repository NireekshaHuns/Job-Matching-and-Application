import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { extractInventory } from './extract';

function chatReturning(json: unknown): ChatClient {
  return { complete: async () => JSON.stringify(json) };
}

describe('extractInventory', () => {
  it('drafts a validated inventory from the model output', async () => {
    const chat = chatReturning({
      skills: [
        { skill: 'Go', kind: 'technical' },
        { skill: 'ownership', kind: 'soft' },
      ],
      bullets: [
        {
          text: 'Shipped a Go service that cut latency by 40%.',
          skills: ['go'],
          roleFamily: 'backend',
          company: 'Acme',
        },
      ],
    });
    const inv = await extractInventory('resume text', chat);
    expect(inv.skills).toContainEqual({ skill: 'go', kind: 'technical' });
    expect(inv.bullets[0].roleFamily).toBe('backend');
    expect(inv.baseResumes).toEqual([]);
  });

  it('reconciles a bullet tag missing from skills (adds it as technical)', async () => {
    const chat = chatReturning({
      skills: [{ skill: 'go', kind: 'technical' }],
      bullets: [{ text: 'Built a Kafka pipeline.', skills: ['go', 'kafka'] }],
    });
    // Without reconciliation, parseInventory would reject the "kafka" tag.
    const inv = await extractInventory('resume', chat);
    expect(inv.skills.map((s) => s.skill)).toContain('kafka');
  });

  it('coerces an unknown skill kind to technical and drops a bad role family', async () => {
    const chat = chatReturning({
      skills: [{ skill: 'rust', kind: 'wizardry' }],
      bullets: [{ text: 'Wrote Rust.', skills: ['rust'], roleFamily: 'astronaut' }],
    });
    const inv = await extractInventory('resume', chat);
    expect(inv.skills).toContainEqual({ skill: 'rust', kind: 'technical' });
    expect(inv.bullets[0].roleFamily).toBeNull();
  });

  it('throws when the model returns no JSON object', async () => {
    await expect(extractInventory('resume', chatReturning('' as never))).rejects.toThrow();
  });
});
