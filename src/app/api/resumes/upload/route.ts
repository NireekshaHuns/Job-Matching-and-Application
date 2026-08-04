/**
 * Résumé corpus upload. Accepts one or more PDF/.tex/.txt files (multipart),
 * extracts text, and ingests each into the corpus (LLM skills/bullets + bullet
 * embeddings when OPENAI_API_KEY is set; raw text only otherwise). Node runtime
 * so unpdf + the OpenAI SDK work. Returns per-file counts and errors.
 */
import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { roleFamilyEnum } from '@/server/db/schema';
import type { ChatClient, Embedder, RoleFamily } from '@/server/enrich/types';
import { ingestResume, type IngestDeps } from '@/server/resume/corpus-ingest';
import { pdfToText } from '@/server/resume/pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Upload limits — résumés are small; keep cost/latency bounded. */
const MAX_FILES = 10;
const MAX_FILE_BYTES = 4_000_000; // 4MB per file

/** Wire real OpenAI deps when a key is present; otherwise text-only ingest. */
async function buildDeps(): Promise<IngestDeps> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { db };
  const { default: OpenAI } = await import('openai');
  const { openaiChat, openaiEmbedder } = await import('@/server/enrich/openai');
  const client = new OpenAI({ apiKey: key });
  // Extraction returns JSON (jsonMode default true); embeddings for retrieval.
  const chat: ChatClient = openaiChat(client, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
  const embedder: Embedder = openaiEmbedder(
    client,
    process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small',
  );
  return { db, chat, embedder };
}

/** Filename without directory or extension, for the résumé label. */
function baseName(name: string): string {
  const file = name.split(/[\\/]/).pop() ?? name;
  return file.replace(/\.[^.]+$/, '').trim() || 'Uploaded résumé';
}

function parseRoleFamily(value: FormDataEntryValue | null): RoleFamily | null {
  if (typeof value !== 'string') return null;
  return (roleFamilyEnum.enumValues as readonly string[]).includes(value)
    ? (value as RoleFamily)
    : null;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
  }
  // Bound work per request: résumés are small, and each bullet triggers an embed
  // call, so cap file count + size to keep cost/latency under maxDuration.
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES} per upload).` },
      { status: 413 },
    );
  }
  const roleFamily = parseRoleFamily(form.get('roleFamily'));

  const deps = await buildDeps();
  const ingested: Array<{ label: string; resumeId: number; skills: number; bullets: number }> = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`File is too large (max ${MAX_FILE_BYTES / 1_000_000}MB).`);
      }
      const lower = file.name.toLowerCase();
      let text: string;
      if (lower.endsWith('.pdf')) {
        text = await pdfToText(new Uint8Array(await file.arrayBuffer()));
      } else {
        text = (await file.text()).trim();
      }
      if (!text) throw new Error('File has no extractable text.');
      const result = await ingestResume({ label: baseName(file.name), text, roleFamily }, deps);
      ingested.push({ label: baseName(file.name), ...result });
    } catch (e) {
      errors.push({ file: file.name, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ingested, errors, extracted: Boolean(deps.chat) });
}
