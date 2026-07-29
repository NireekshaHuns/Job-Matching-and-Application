/**
 * PDF → plain text via unpdf (serverless-friendly, no native deps). Isolated so
 * the rest of the extractor stays testable without a PDF fixture.
 */
import { extractText, getDocumentProxy } from 'unpdf';

/** Extract all text from a PDF's bytes. Throws a clear error on bad/empty PDFs. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch (e) {
    throw new Error(`Could not read PDF: ${(e as Error).message}`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('No extractable text (is this a scanned/image-only PDF?).');
  }
  return trimmed;
}
