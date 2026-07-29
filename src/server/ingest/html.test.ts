import { describe, expect, it } from 'vitest';
import { htmlToText, toIsoDate } from './html';

describe('htmlToText', () => {
  it('decodes entity-encoded markup and flattens to text', () => {
    const text = htmlToText(
      '&lt;p&gt;Build &amp;amp; scale APIs.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;',
    );
    expect(text).toContain('Build & scale APIs.');
    expect(text).toContain('Go');
    expect(text).not.toContain('<p>');
  });

  it('strips real HTML tags too', () => {
    expect(htmlToText('<p>Hi <b>there</b></p>')).toBe('Hi there');
  });

  it('keeps a comparison operator that is not tag-shaped', () => {
    expect(htmlToText('use a < b for the check')).toBe('use a < b for the check');
  });

  it('turns block/br boundaries into line breaks', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });
});

describe('toIsoDate', () => {
  it('normalizes ISO strings and epoch millis; null for junk', () => {
    expect(toIsoDate('2026-07-20T12:00:00-04:00')).toBe('2026-07-20');
    expect(toIsoDate(Date.parse('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});
