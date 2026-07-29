import { describe, expect, it } from 'vitest';
import { parseInventory } from './inventory';

describe('parseInventory', () => {
  it('normalizes and de-duplicates skills (last kind wins)', () => {
    const inv = parseInventory({
      skills: [
        { skill: 'Go', kind: 'technical' },
        { skill: 'go', kind: 'soft' },
        { skill: 'Ownership', kind: 'soft' },
      ],
    });
    expect(inv.skills).toEqual([
      { skill: 'go', kind: 'soft' },
      { skill: 'ownership', kind: 'soft' },
    ]);
  });

  it('normalizes bullet tags and defaults optional fields to null', () => {
    const inv = parseInventory({
      skills: [
        { skill: 'go', kind: 'technical' },
        { skill: 'kafka', kind: 'technical' },
      ],
      bullets: [{ text: '  Shipped a Go service.  ', skills: ['Go', 'go', ' Kafka '] }],
    });
    expect(inv.bullets[0].text).toBe('Shipped a Go service.');
    expect(inv.bullets[0].skills).toEqual(['go', 'kafka']);
    expect(inv.bullets[0].roleFamily).toBeNull();
    expect(inv.bullets[0].company).toBeNull();
  });

  it('keeps base resume content and role family', () => {
    const inv = parseInventory({
      baseResumes: [
        { label: 'Backend', roleFamily: 'backend', content: '\\documentclass{article}' },
      ],
    });
    expect(inv.baseResumes[0]).toMatchObject({
      label: 'Backend',
      roleFamily: 'backend',
      content: '\\documentclass{article}',
    });
  });

  it('defaults all sections to empty arrays and allows a _comment', () => {
    expect(parseInventory({ _comment: 'notes' })).toEqual({
      skills: [],
      bullets: [],
      baseResumes: [],
    });
  });

  it('rejects an unknown top-level key (catches typos)', () => {
    expect(() => parseInventory({ bulets: [] })).toThrow();
  });

  it('rejects an invalid skill kind', () => {
    expect(() => parseInventory({ skills: [{ skill: 'go', kind: 'wizardry' }] })).toThrow();
  });

  it('rejects an invalid role family on a bullet', () => {
    expect(() => parseInventory({ bullets: [{ text: 'x', roleFamily: 'astronaut' }] })).toThrow();
  });

  it('rejects a bullet tag that is not a declared master skill', () => {
    expect(() =>
      parseInventory({
        skills: [{ skill: 'go', kind: 'technical' }],
        bullets: [{ text: 'Built a Rust service.', skills: ['rust'] }],
      }),
    ).toThrow(/rust/i);
  });
});
