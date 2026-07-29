import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { extractInventory } from './extract';

function chatReturning(json: unknown): ChatClient {
  return { complete: async () => JSON.stringify(json) };
}
function chatRaw(text: string): ChatClient {
  return { complete: async () => text };
}

describe('extractInventory', () => {
  it('drafts a validated inventory from the model output', async () => {
    const { inventory } = await extractInventory(
      'resume',
      chatReturning({
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
      }),
    );
    expect(inventory.skills).toContainEqual({ skill: 'go', kind: 'technical' });
    expect(inventory.skills).toContainEqual({ skill: 'ownership', kind: 'soft' });
    expect(inventory.bullets[0].roleFamily).toBe('backend');
    expect(inventory.baseResumes).toEqual([]);
  });

  it('reconciles a bullet tag missing from skills and reports it', async () => {
    const { inventory, reconciledSkills } = await extractInventory(
      'resume',
      chatReturning({
        skills: [{ skill: 'go', kind: 'technical' }],
        bullets: [{ text: 'Built a Kafka pipeline.', skills: ['go', 'kafka'] }],
      }),
    );
    expect(inventory.skills.map((s) => s.skill)).toContain('kafka');
    expect(reconciledSkills).toEqual(['kafka']);
  });

  it('coerces an unknown skill kind to technical and drops a bad role family', async () => {
    const { inventory } = await extractInventory(
      'resume',
      chatReturning({
        skills: [{ skill: 'rust', kind: 'wizardry' }],
        bullets: [{ text: 'Wrote Rust.', skills: ['rust'], roleFamily: 'astronaut' }],
      }),
    );
    expect(inventory.skills).toContainEqual({ skill: 'rust', kind: 'technical' });
    expect(inventory.bullets[0].roleFamily).toBeNull();
  });

  it('tolerates non-array skills/bullets and non-object elements', async () => {
    const { inventory } = await extractInventory(
      'resume',
      chatReturning({
        skills: { nope: true },
        bullets: [null, 'x', { text: 'Led a team of 5.', skills: [] }],
      }),
    );
    expect(inventory.skills).toEqual([]);
    expect(inventory.bullets).toHaveLength(1);
    expect(inventory.bullets[0].text).toBe('Led a team of 5.');
  });

  it('drops whitespace-only tags and skills without throwing', async () => {
    const { inventory } = await extractInventory(
      'resume',
      chatReturning({
        skills: [{ skill: '   ', kind: 'technical' }],
        bullets: [{ text: 'Did work.', skills: ['   '] }],
      }),
    );
    expect(inventory.skills).toEqual([]);
    expect(inventory.bullets[0].skills).toEqual([]);
  });

  it('throws a friendly error when the model returns no JSON', async () => {
    await expect(extractInventory('resume', chatRaw('sorry, no json here'))).rejects.toThrow(
      /No JSON object/,
    );
  });

  it('throws a friendly error on malformed JSON', async () => {
    await expect(extractInventory('resume', chatRaw('{ "skills": [ }'))).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
