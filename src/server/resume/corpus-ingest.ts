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
}

export interface IngestResult {
  resumeId: number;
  skills: number;
  bullets: number;
}

type BatchStatements = Parameters<DB['batch']>[0];
type BatchStatement = BatchStatements[number];

/** Ingest one résumé; returns counts for the upload UI. */
export async function ingestResume(input: IngestResumeInput, deps: IngestDeps): Promise<IngestResult> {
  const { db, chat, embedder } = deps;

  const inventory = chat
    ? (await extractInventory(input.text, chat)).inventory
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

  // Embed bullets (sequential — corpora are small; keeps the Embedder interface
  // single-text). A failed embed leaves that bullet without a vector, not lost.
  const bulletRows: NewResumeBullet[] = [];
  for (const b of inventory.bullets) {
    let embedding: number[] | null = null;
    if (embedder) {
      try {
        embedding = await embedder.embed(b.text);
      } catch {
        embedding = null;
      }
    }
    bulletRows.push({
      text: b.text,
      skills: b.skills,
      roleFamily: b.roleFamily,
      company: b.company,
      sourceResumeId: resumeId,
      embedding,
    });
  }

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
