import { extractText, getDocumentProxy } from 'unpdf';
import { readFile } from 'node:fs/promises';
async function main() {
  const buf = new Uint8Array(await readFile(process.argv[2]));
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  console.log('PAGES:', totalPages);
  (text as string[]).forEach((p, i) => {
    console.log(`\n===== PAGE ${i + 1} =====`);
    console.log(p);
  });
}
main();
