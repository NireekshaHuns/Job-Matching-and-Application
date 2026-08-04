'use client';

/**
 * Settings — the fixed inputs the tailoring engine uses: the candidate profile
 * (identity + real metrics/stack), the skills superset, and the base résumé
 * LaTeX format. Résumés + bullets are uploaded in the Studio, not hand-entered
 * here. Plain Tailwind to match the current app.
 */
import { useState } from 'react';
import { Chip } from '@/components/chip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import { ROLE_FAMILIES, type RoleFamily } from '@/lib/role-families';
import { trpc } from '@/trpc/react';

const SKILL_KINDS = ['technical', 'soft'] as const;
type SkillKind = (typeof SKILL_KINDS)[number];

const inputCls =
  'rounded-md border border-border bg-surface px-2 py-1 text-sm focus:border-brand focus:outline-none';
const btnCls =
  'rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-surface-2 disabled:opacity-50';

/** Inline mutation error, matching the app's ErrorState tone. */
function MutationError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600 dark:text-rose-400">{message}</p>;
}

export default function SettingsPage() {
  const inventory = trpc.resumes.inventory.useQuery();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted text-sm">
          The fixed facts every generated résumé uses, your skills superset, and the LaTeX format.
          Upload your résumés and skills in the{' '}
          <a className="underline" href="/studio">
            Studio
          </a>
          .
        </p>
      </header>

      <div className="flex flex-col gap-8">
        <ProfileSection />
        {inventory.isError ? (
          <ErrorState message={inventory.error.message} onRetry={() => inventory.refetch()} />
        ) : inventory.data ? (
          <>
            <SkillsSection skills={inventory.data.skills} />
            <BaseResumesSection resumes={inventory.data.baseResumes} />
          </>
        ) : (
          <LoadingSkeleton />
        )}
      </div>
    </main>
  );
}

// ------------------------------------------------------------- Candidate profile

/** The profile fields, in render order — label, key, and whether it's multiline. */
const PROFILE_FIELDS = [
  ['Name', 'name', false],
  ['Email', 'email', false],
  ['Phone', 'phone', false],
  ['LinkedIn URL', 'linkedinUrl', false],
  ['GitHub URL', 'githubUrl', false],
  ['Graduation', 'gradDate', false],
  ['Certification text', 'certText', false],
  ['Certification URL', 'certUrl', false],
  ['Real / verified metrics (preferred before inventing)', 'knownMetrics', true],
  ['Confirmed stack & domain notes', 'stackNotes', true],
] as const;

type ProfileKey = (typeof PROFILE_FIELDS)[number][1];
type ProfileValues = Record<ProfileKey, string>;

function ProfileSection() {
  const utils = trpc.useUtils();
  const profile = trpc.resumes.getProfile.useQuery();
  const save = trpc.resumes.setProfile.useMutation({
    onSuccess: () => utils.resumes.getProfile.invalidate(),
  });

  return (
    <section className="border-border rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Candidate profile</h2>
      <p className="text-muted mb-3 text-sm">
        Identity (name, contacts, links, cert) is treated as fixed truth; the metrics/stack notes
        are what the generator prefers before inventing anything. Pre-filled with sensible defaults
        — add your phone and profile links.
      </p>
      {profile.isError ? (
        <ErrorState message={profile.error.message} onRetry={() => profile.refetch()} />
      ) : profile.data ? (
        <ProfileForm
          initial={profile.data}
          saving={save.isPending}
          error={save.error?.message}
          onSave={(values) => save.mutate(values)}
        />
      ) : (
        <LoadingSkeleton rows={3} />
      )}
    </section>
  );
}

function ProfileForm({
  initial,
  onSave,
  saving,
  error,
}: {
  initial: Record<ProfileKey, string | null>;
  onSave: (values: ProfileValues) => void;
  saving: boolean;
  error?: string;
}) {
  const seed = () =>
    Object.fromEntries(PROFILE_FIELDS.map(([, key]) => [key, initial[key] ?? ''])) as ProfileValues;
  const [values, setValues] = useState<ProfileValues>(seed);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {PROFILE_FIELDS.map(([label, key, multiline]) => (
          <label
            key={key}
            className={`text-muted flex flex-col gap-1 text-xs ${multiline ? 'sm:col-span-2' : ''}`}
          >
            {label}
            {multiline ? (
              <textarea
                className={`${inputCls} min-h-20`}
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            ) : (
              <input
                className={inputCls}
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btnCls} onClick={() => onSave(values)} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <MutationError message={error} />
      </div>
    </div>
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
    <section className="border-border rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Master skills</h2>
      <p className="text-muted mb-3 text-sm">
        The superset of everything you can truthfully claim. The TECHNICAL SKILLS section is
        selected from this per job.
      </p>

      {SKILL_KINDS.map((k) => (
        <div key={k} className="mb-3">
          <div className="text-muted mb-1 text-xs font-medium tracking-wide uppercase">{k}</div>
          {byKind(k).length === 0 ? (
            <span className="text-faint text-sm">None yet.</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {byKind(k).map((s) => (
                <li key={s.skill}>
                  <span className="bg-surface-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                    {s.skill}
                    <button
                      type="button"
                      aria-label={`Remove ${s.skill}`}
                      className="text-faint hover:text-rose-600 dark:hover:text-rose-400"
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
    <section className="border-border rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Base résumé format</h2>
          <p className="text-muted text-sm">
            Optional LaTeX template. When set, the Studio uses it as the exact format to fill; leave
            empty to use the built-in one-page template.
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
    <li className="border-border rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{resume.label}</span>
        {resume.roleFamily && <Chip>{resume.roleFamily}</Chip>}
        <span className="text-faint text-xs">{resume.content?.length ?? 0} chars</span>
        <button
          type="button"
          className="text-muted hover:text-fg ml-auto text-xs"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="text-muted text-xs hover:text-rose-600 dark:hover:text-rose-400"
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
    <div className="border-border mt-2 flex flex-col gap-2 rounded-md border p-2">
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
