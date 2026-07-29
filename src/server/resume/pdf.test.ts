import { describe, expect, it, vi } from 'vitest';

// Mock unpdf so we test pdfToText's own logic without a real PDF fixture.
const extractText = vi.fn();
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: (...args: unknown[]) => extractText(...args),
}));

const { pdfToText } = await import('./pdf');

describe('pdfToText', () => {
  it('returns trimmed extracted text', async () => {
    extractText.mockResolvedValueOnce({ text: '  Hello resume  ' });
    expect(await pdfToText(new Uint8Array())).toBe('Hello resume');
  });

  it('throws a clear error for a PDF with no extractable text', async () => {
    extractText.mockResolvedValueOnce({ text: '   ' });
    await expect(pdfToText(new Uint8Array())).rejects.toThrow(/no extractable text/i);
  });

  it('wraps a parse failure', async () => {
    extractText.mockRejectedValueOnce(new Error('bad xref'));
    await expect(pdfToText(new Uint8Array())).rejects.toThrow(/Could not read PDF/);
  });
});
