'use client';

/**
 * Settings — manage the truthful résumé inventory the tailoring engine draws
 * from: the master skills superset, the per-role bullet bank, and the base
 * résumé template(s). Plain Tailwind to match the current app; the Phase 3
 * redesign polishes this later.
 */
import { useState } from 'react';
import { Chip } from '@/components/chip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import { ROLE_FAMILIES, type RoleFamily } from '@/lib/role-families';
import { trpc } from '@/trpc/react';

const SKILL_KINDS = ['technical', 'soft'] as const;
type SkillKind = (typeof SKILL_KINDS)[number];

/** Split a free-text "Go, Kafka, Redis" field into a clean list. */
function parseSkills(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const inputCls =
  'rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none';
const btnCls =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50';

/** Inline mutation error, matching the app's ErrorState tone. */
function MutationError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}

export default function SettingsPage() {
  const inventory = trpc.resumes.inventory.useQuery();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500">
          Your truthful résumé inventory. Tailoring only ever surfaces skills and bullets you add
          here — it never invents anything.
        </p>
      </header>

      {inventory.isError ? (
        <ErrorState message={inventory.error.message} onRetry={() => inventory.refetch()} />
      ) : inventory.data ? (
        <div className="flex flex-col gap-8">
          <SkillsSection skills={inventory.data.skills} />
          <BulletsSection bullets={inventory.data.bullets} />
          <BaseResumesSection resumes={inventory.data.baseResumes} />
        </div>
      ) : (
        <LoadingSkeleton />
      )}
    </main>
  );
}

// ---------------------------------------------------------------- Master skills

function SkillsSection({ skills }: { skills: { skill: string; kind: SkillKind }[] }) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.resumes.inventory.invalidate();
  const add = trpc.resumes.addSkill.useMutation({ onSuccess: invalidate });
  const remove = trpc.resumes.removeSkill.useMutation({ onSuccess: invalidate });

  const [skill, setSkill] = useState('');
  const [kind, setKind] = useState<SkillKind>('technical');

  const submit = () => {
    const s = skill.trim();
    if (!s) return;
    add.mutate({ skill: s, kind });
    setSkill('');
  };

  const byKind = (k: SkillKind) => skills.filter((s) => s.kind === k);

  return (
    <section className="rounded-lg border border-zinc-200 p-4">
      <h2 className="text-lg font-semibold">Master skills</h2>
      <p className="mb-3 text-sm text-zinc-500">
        The superset of everything you can truthfully claim. The TECHNICAL SKILLS section is
        selected from this per job.
      </p>

      {SKILL_KINDS.map((k) => (
        <div key={k} className="mb-3">
          <div className="mb-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">{k}</div>
          {byKind(k).length === 0 ? (
            <span className="text-sm text-zinc-400">None yet.</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {byKind(k).map((s) => (
                <li key={s.skill}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                    {s.skill}
                    <button
                      type="button"
                      aria-label={`Remove ${s.skill}`}
                      className="text-zinc-400 hover:text-red-600"
                      onClick={() => remove.mutate({ skill: s.skill })}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          aria-label="Add a skill"
          placeholder="Add a skill (e.g. GraphQL)"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <select
          className={inputCls}
          aria-label="Skill kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as SkillKind)}
        >
          {SKILL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="button" className={btnCls} onClick={submit} disabled={add.isPending}>
          Add
        </button>
      </div>
      <MutationError message={add.error?.message ?? remove.error?.message} />
    </section>
  );
}

// ------------------------------------------------------------------ Bullet bank

interface Bullet {
  id: number;
  text: string;
  skills: string[];
  roleFamily: RoleFamily | null;
  company: string | null;
}

function BulletsSection({ bullets }: { bullets: Bullet[] }) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.resumes.inventory.invalidate();
  const add = trpc.resumes.addBullet.useMutation({ onSuccess: invalidate });

  const [text, setText] = useState('');
  const [skills, setSkills] = useState('');
  const [roleFamily, setRoleFamily] = useState<RoleFamily | ''>('');
  const [company, setCompany] = useState('');

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    add.mutate({
      text: t,
      skills: parseSkills(skills),
      roleFamily: roleFamily === '' ? null : roleFamily,
      company: company.trim() || null,
    });
    setText('');
    setSkills('');
    setCompany('');
  };

  return (
    <section className="rounded-lg border border-zinc-200 p-4">
      <h2 className="text-lg font-semibold">Bullet bank</h2>
      <p className="mb-3 text-sm text-zinc-500">
        Real accomplishments, each tagged with the skills it truthfully demonstrates. Tailoring can
        only surface a skill inside an experience bullet if it is tagged here.
      </p>

      {bullets.length === 0 ? (
        <EmptyState title="No bullets yet. Add your real accomplishments below." />
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {bullets.map((b) => (
            <BulletRow key={b.id} bullet={b} onChanged={invalidate} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
        <textarea
          className={`${inputCls} min-h-16`}
          aria-label="Bullet text"
          placeholder="Accomplishment (Google XYZ: shipped X, measured by Y, by doing Z)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          className={inputCls}
          aria-label="Bullet skills (comma-separated)"
          placeholder="Skills, comma-separated (e.g. java, spring boot, kafka)"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputCls}
            aria-label="Bullet role family"
            value={roleFamily}
            onChange={(e) => setRoleFamily(e.target.value as RoleFamily | '')}
          >
            <option value="">(no role family)</option>
            {ROLE_FAMILIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            aria-label="Bullet company"
            placeholder="Company (optional)"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <button type="button" className={btnCls} onClick={submit} disabled={add.isPending}>
            Add bullet
          </button>
        </div>
        <MutationError message={add.error?.message} />
      </div>
    </section>
  );
}

function BulletRow({ bullet, onChanged }: { bullet: Bullet; onChanged: () => void }) {
  const update = trpc.resumes.updateBullet.useMutation({ onSuccess: onChanged });
  const remove = trpc.resumes.removeBullet.useMutation({ onSuccess: onChanged });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bullet.text);
  const [skills, setSkills] = useState(bullet.skills.join(', '));

  /** Reset the draft to the current bullet (used on open + cancel). */
  const resetDraft = () => {
    setText(bullet.text);
    setSkills(bullet.skills.join(', '));
  };

  if (editing) {
    return (
      <li className="rounded-md border border-zinc-200 p-2">
        <textarea
          className={`${inputCls} mb-2 w-full`}
          aria-label="Edit bullet text"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          className={`${inputCls} mb-2 w-full`}
          aria-label="Edit bullet skills"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnCls}
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ id: bullet.id, text: text.trim(), skills: parseSkills(skills) });
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              resetDraft();
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <MutationError message={update.error?.message} />
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-zinc-200 p-2">
      <p className="text-sm">{bullet.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {bullet.roleFamily && <Chip>{bullet.roleFamily}</Chip>}
        {bullet.company && <Chip muted>{bullet.company}</Chip>}
        {bullet.skills.map((s) => (
          <span key={s} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {s}
          </span>
        ))}
        <button
          type="button"
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
          onClick={() => {
            resetDraft();
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-red-600"
          onClick={() => remove.mutate({ id: bullet.id })}
        >
          Remove
        </button>
      </div>
      <MutationError message={remove.error?.message} />
    </li>
  );
}

// --------------------------------------------------------------- Base résumés

interface BaseResume {
  id: number;
  label: string;
  roleFamily: RoleFamily | null;
  content: string | null;
}

function BaseResumesSection({ resumes }: { resumes: BaseResume[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-lg border border-zinc-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Base résumés</h2>
          <p className="text-sm text-zinc-500">
            Your LaTeX template(s). Headings, the header, and the PROJECTS section are kept verbatim
            when tailoring.
          </p>
        </div>
        <button type="button" className={btnCls} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add résumé'}
        </button>
      </div>

      {adding && <BaseResumeEditor onDone={() => setAdding(false)} />}

      {resumes.length === 0 && !adding ? (
        <EmptyState title="No base résumé yet. Add your LaTeX template to enable tailoring." />
      ) : (
        <ul className="flex flex-col gap-2">
          {resumes.map((r) => (
            <BaseResumeRow key={r.id} resume={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BaseResumeRow({ resume }: { resume: BaseResume }) {
  const utils = trpc.useUtils();
  const remove = trpc.resumes.removeBaseResume.useMutation({
    onSuccess: () => utils.resumes.inventory.invalidate(),
  });
  const [editing, setEditing] = useState(false);

  const confirmRemove = () => {
    // Deleting a base résumé cascades its job relevance scores (job_scores).
    if (window.confirm(`Delete "${resume.label}"? This also clears its fit scores.`)) {
      remove.mutate({ id: resume.id });
    }
  };

  return (
    <li className="rounded-md border border-zinc-200 p-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{resume.label}</span>
        {resume.roleFamily && <Chip>{resume.roleFamily}</Chip>}
        <span className="text-xs text-zinc-400">{resume.content?.length ?? 0} chars</span>
        <button
          type="button"
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-red-600"
          onClick={confirmRemove}
        >
          Remove
        </button>
      </div>
      <MutationError message={remove.error?.message} />
      {editing && <BaseResumeEditor resume={resume} onDone={() => setEditing(false)} />}
    </li>
  );
}

function BaseResumeEditor({ resume, onDone }: { resume?: BaseResume; onDone: () => void }) {
  const utils = trpc.useUtils();
  const upsert = trpc.resumes.upsertBaseResume.useMutation({
    onSuccess: () => {
      utils.resumes.inventory.invalidate();
      onDone();
    },
  });
  const [label, setLabel] = useState(resume?.label ?? '');
  const [roleFamily, setRoleFamily] = useState<RoleFamily | ''>(resume?.roleFamily ?? '');
  const [content, setContent] = useState(resume?.content ?? '');

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          aria-label="Résumé label"
          placeholder="Label (e.g. Backend base)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className={inputCls}
          aria-label="Résumé role family"
          value={roleFamily}
          onChange={(e) => setRoleFamily(e.target.value as RoleFamily | '')}
        >
          <option value="">(no role family)</option>
          {ROLE_FAMILIES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className={`${inputCls} min-h-48 font-mono text-xs`}
        aria-label="Résumé LaTeX source"
        placeholder="\documentclass... (full LaTeX source)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div>
        <button
          type="button"
          className={btnCls}
          disabled={upsert.isPending || !label.trim() || !content.trim()}
          onClick={() =>
            upsert.mutate({
              id: resume?.id,
              label: label.trim(),
              roleFamily: roleFamily === '' ? null : roleFamily,
              content,
            })
          }
        >
          {resume ? 'Save' : 'Add'}
        </button>
      </div>
      <MutationError message={upsert.error?.message} />
    </div>
  );
}
