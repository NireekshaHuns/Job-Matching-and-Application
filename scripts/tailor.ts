/**
 * Generate a tailored LaTeX resume for a job.
 *
 * Usage: pnpm tailor <jobId> [--resume <id|label>] [-o out.tex]
 * Requires DATABASE_URL and OPENAI_API_KEY. Reads the job, a base resume, and
 * the inventory; writes a .tex file and prints a report. Does not touch the DB.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import OpenAI from 'openai';
import * as schema from '@/server/db/schema';
import { jobs, masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import { openaiChat } from '@/server/enrich/openai';
import { selectTailoringInputs, tailorResume, type TailorBullet } from '@/server/resume/tailor';

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('-') ? next : undefined;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'resume'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const jobId = Number(args.find((a) => !a.startsWith('-')));
  const resumeSel = arg(args, '--resume');
  const outArg = arg(args, '-o') ?? arg(args, '--out');

  if (!Number.isInteger(jobId)) {
    console.error('usage: pnpm tailor <jobId> [--resume <id|label>] [-o out.tex]');
    process.exit(1);
  }
  for (const key of ['DATABASE_URL', 'OPENAI_API_KEY']) {
    if (!process.env[key]) {
      console.error(`${key} is not set (check .env).`);
      process.exit(1);
    }
  }

  const db = drizzle(neon(process.env.DATABASE_URL as string), { schema });

  const [job] = await db
    .select({
      title: jobs.title,
      company: jobs.company,
      roleFamily: jobs.roleFamily,
      techKeywords: jobs.techKeywords,
      softKeywords: jobs.softKeywords,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) {
    console.error(`No job with id ${jobId}.`);
    process.exit(1);
  }

  const baseResumes = await db
    .select({
      id: resumes.id,
      label: resumes.label,
      roleFamily: resumes.roleFamily,
      content: resumes.content,
    })
    .from(resumes)
    .where(eq(resumes.kind, 'base'));

  const base = resumeSel
    ? baseResumes.find((r) =>
        Number.isInteger(Number(resumeSel))
          ? r.id === Number(resumeSel)
          : r.label.toLowerCase() === resumeSel.toLowerCase(),
      )
    : (baseResumes.find((r) => r.roleFamily === job.roleFamily) ?? baseResumes[0]);

  if (!base) {
    console.error('No matching base resume. Load one via pnpm inventory:load.');
    process.exit(1);
  }
  if (!base.content) {
    console.error(`Base resume "${base.label}" has no LaTeX content.`);
    process.exit(1);
  }

  const [skillRows, bulletRows] = await Promise.all([
    db.select({ skill: masterSkills.skill }).from(masterSkills),
    db
      .select({
        text: resumeBullets.text,
        skills: resumeBullets.skills,
        roleFamily: resumeBullets.roleFamily,
      })
      .from(resumeBullets),
  ]);

  const bullets: TailorBullet[] = bulletRows.map((b) => ({
    text: b.text,
    skills: b.skills,
    roleFamily: b.roleFamily,
  }));
  const inputs = selectTailoringInputs(
    job,
    skillRows.map((s) => s.skill),
    bullets,
    base.roleFamily,
  );

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
  const { latex, report } = await tailorResume(base.content, job, inputs, chat);

  const out = outArg ?? `tailored/${slug(job.company)}-${jobId}.tex`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${latex}\n`);

  console.log(`Tailored "${base.label}" for ${job.title} @ ${job.company} -> ${out}`);
  console.log(`Attempts: ${report.attempts} | linter: ${report.lint.ok ? 'passed' : 'FAILED'}`);
  console.log(`Woven keywords: ${report.coverableKeywords.join(', ') || '(none)'}`);
  if (report.trueGaps.length)
    console.log(`Not covered (you lack these): ${report.trueGaps.join(', ')}`);
  if (report.unexpectedGaps.length)
    console.log(`REVIEW — gaps that appeared in the output: ${report.unexpectedGaps.join(', ')}`);
  if (!report.lint.ok) {
    console.log('Remaining linter issues:');
    for (const v of report.lint.violations) console.log(`  - [${v.severity}] ${v.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
