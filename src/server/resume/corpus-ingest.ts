/**
 * Ingest an uploaded résumé into the corpus: LLM-extract its skills + bullets,
 * embed each bullet for retrieval, and persist. The résumé row, its bullets
 * (linked via `source_resume_id`), and the merged master skills make up the RAG
 * corpus the Studio tailors from. Degrades gracefully: no `chat` → store raw
 * text only; no `embedder` → store bullets without embeddings (keyword-overlap
 * retrieval still works). External services are injected (fakes-first).
 */
import type { DB } from '@/server/db';
import { masterSkills, resumeBullets, resumes, type NewResumeBullet } from '@/server/db/schema';
import type { ChatClient, Embedder, RoleFamily } from '@/server/enrich/types';
import { extractInventory } from './extract';

export interface IngestDeps {
  db: DB;
  /** LLM used to extract the skills/bullets inventory; omit to store text only. */
  chat?: ChatClient;
  /** Embeds each bullet for semantic retrieval; omit to skip embeddings. */
  embedder?: Embedder;
}

export interface IngestResumeInput {
  label: string;
  /** Plain text of the résumé (already extracted from PDF/tex/txt upstream). */
  text: string;
  roleFamily?: RoleFamily | null;
  /** `uploaded` (a past résumé) by default; `tailored` when saving a generated one. */
  kind?: 'uploaded' | 'tailored';
  /**
   * Text to run extraction against, when it differs from what's stored. Used to
   * feed plain text (LaTeX markup stripped) to the extractor while `content`
   * keeps the original LaTeX. Defaults to `text`.
   */
  extractText?: string;
}

export interface IngestResult {
  resumeId: number;
  skills: number;
  bullets: number;
}

type BatchStatements = Parameters<DB['batch']>[0];
type BatchStatement = BatchStatements[number];

/**
 * Vectors for every bullet, in order, with `null` wherever one is unavailable.
 * Prefers the embedder's batch call; falls back to one call per bullet for
 * embedders that don't implement it. Never throws — embeddings are an
 * optimization for retrieval, so a failure must not lose the bullets.
 */
export async function embedBullets(
  texts: string[],
  embedder?: Embedder,
): Promise<(number[] | null)[]> {
  if (!embedder || texts.length === 0) return texts.map(() => null);

  if (embedder.embedMany) {
    try {
      const vectors = await embedder.embedMany(texts);
      // Defend against a short/long result rather than silently misaligning
      // vectors with bullets.
      if (vectors.length === texts.length) return vectors;
    } catch {
      // fall through to the per-bullet path
    }
  }

  const out: (number[] | null)[] = [];
  for (const text of texts) {
    try {
      out.push(await embedder.embed(text));
    } catch {
      out.push(null);
    }
  }
  return out;
}

/** Ingest one résumé; returns counts for the upload UI. */
export async function ingestResume(
  input: IngestResumeInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { db, chat, embedder } = deps;

  const inventory = chat
    ? (await extractInventory(input.extractText ?? input.text, chat)).inventory
    : { skills: [], bullets: [], baseResumes: [] };

  // Insert the résumé first so bullets can reference it (FK).
  const [resumeRow] = await db
    .insert(resumes)
    .values({
      label: input.label,
      kind: input.kind ?? 'uploaded',
      roleFamily: input.roleFamily ?? null,
      content: input.text,
    })
    .returning({ id: resumes.id });
  const resumeId = resumeRow.id;

  // Embed bullets in ONE round trip when the embedder can batch. Doing this per
  // bullet cost a request each and was enough, across a couple of résumés, to
  // run an upload past its serverless time limit. A failed embed leaves that
  // bullet without a vector, not lost — keyword-overlap retrieval still works.
  const embeddings = await embedBullets(
    inventory.bullets.map((b) => b.text),
    embedder,
  );
  const bulletRows: NewResumeBullet[] = inventory.bullets.map((b, i) => ({
    text: b.text,
    skills: b.skills,
    roleFamily: b.roleFamily,
    company: b.company,
    sourceResumeId: resumeId,
    embedding: embeddings[i] ?? null,
  }));

  const statements: BatchStatement[] = [];
  if (bulletRows.length > 0) statements.push(db.insert(resumeBullets).values(bulletRows));
  if (inventory.skills.length > 0) {
    statements.push(db.insert(masterSkills).values(inventory.skills).onConflictDoNothing());
  }
  if (statements.length > 0) {
    await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  }

  return { resumeId, skills: inventory.skills.length, bullets: bulletRows.length };
}
