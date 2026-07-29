/**
 * Compute and persist fit scores for every (job × base resume) into job_scores.
 * `db` is injected (type-only DB import). Reads the master skills, bullet bank,
 * base resumes, and jobs, then upserts relevanceScore + skillGaps.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { jobScores, jobs, masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import { computeFit, resumeSkillsFromBullets, type BulletLike } from './fit';

const CHUNK_SIZE = 500;

export async function scoreFits(db: DB): Promise<number> {
  const [skills, bullets, baseResumes, jobRows] = await Promise.all([
    db.select({ skill: masterSkills.skill }).from(masterSkills),
    db
      .select({ skills: resumeBullets.skills, roleFamily: resumeBullets.roleFamily })
      .from(resumeBullets),
    db
      .select({ id: resumes.id, roleFamily: resumes.roleFamily })
      .from(resumes)
      .where(eq(resumes.kind, 'base')),
    db
      .select({ id: jobs.id, techKeywords: jobs.techKeywords, softKeywords: jobs.softKeywords })
      .from(jobs),
  ]);

  const masterSkillList = skills.map((s) => s.skill);
  const bulletList: BulletLike[] = bullets.map((b) => ({
    skills: b.skills,
    roleFamily: b.roleFamily,
  }));

  const rows = baseResumes.flatMap((resume) => {
    const resumeSkills = resumeSkillsFromBullets(bulletList, resume.roleFamily);
    return jobRows.map((job) => {
      const fit = computeFit({
        jobKeywords: [...job.techKeywords, ...job.softKeywords],
        resumeSkills,
        masterSkills: masterSkillList,
      });
      return {
        jobId: job.id,
        resumeId: resume.id,
        relevanceScore: fit.relevanceScore,
        skillGaps: fit.missing,
      };
    });
  });

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db
      .insert(jobScores)
      .values(rows.slice(i, i + CHUNK_SIZE))
      .onConflictDoUpdate({
        target: [jobScores.jobId, jobScores.resumeId],
        set: {
          relevanceScore: sql`excluded.relevance_score`,
          skillGaps: sql`excluded.skill_gaps`,
          scoredAt: sql`now()`,
        },
      });
  }

  return rows.length;
}
