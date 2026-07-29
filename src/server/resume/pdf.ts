/**
 * PDF → plain text via unpdf (serverless-friendly, no native deps). Isolated so
 * the rest of the extractor stays testable without a PDF fixture.
 */
import { extractText, getDocumentProxy } from 'unpdf';

/** Extract all text from a PDF's bytes, pages joined by blank lines. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
