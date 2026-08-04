'use client';

/**
 * Tailoring Studio — the corpus-driven résumé workflow.
 *  1. Upload past résumés (+ a skills list) → the corpus the AI mines.
 *  2. Paste a JD → extract tech/soft keywords → tick which to include.
 *  3. Generate a strong, one-page LaTeX résumé and preview/edit/download it
 *     in a live split view (in-browser compile), then save it back to grow the
 *     corpus. Aggressive-but-coherent generation — see server/resume/tailor.ts.
 */
import { useRef, useState } from 'react';
import { KeywordPicker } from '@/components/keyword-picker';
import { ErrorState } from '@/components/page-state';
import { ResumeSplit } from '@/components/resume-split';
import { ROLE_FAMILIES, type RoleFamily } from '@/lib/role-families';
import { trpc } from '@/trpc/react';

const inputCls =
  'rounded-md border border-border bg-surface px-2 py-1 text-sm focus:border-brand focus:outline-none';
const btnCls =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50';
const primaryBtn = `${btnCls} border-brand bg-brand text-white hover:opacity-90`;

interface UploadResponse {
  ingested?: Array<{ label: string; resumeId: number; skills: number; bullets: number }>;
  errors?: Array<{ file: string; error: string }>;
  extracted?: boolean;
  error?: string;
}

function Section({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="bg-surface-2 text-muted inline-flex h-5 w-5 items-center justify-center rounded-full text-xs">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function StudioPage() {
  const utils = trpc.useUtils();
  const corpus = trpc.resumes.listCorpus.useQuery();

  // Step 1 — corpus
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [skillsText, setSkillsText] = useState('');
  const [skillsKind, setSkillsKind] = useState<'technical' | 'soft'>('technical');
  const addSkills = trpc.resumes.addSkills.useMutation();
  const removeResume = trpc.resumes.removeResume.useMutation();

  // Step 2 — JD + keywords
  const [jdText, setJdText] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [roleFamily, setRoleFamily] = useState<RoleFamily | ''>('');
  const extractKw = trpc.resumes.extractJdKeywords.useMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 3 — generate + preview
  const tailor = trpc.resumes.tailorFromCorpus.useMutation();
  const [latex, setLatex] = useState<string | null>(null);
  const [genId, setGenId] = useState(0);
  const save = trpc.resumes.saveTailored.useMutation();
  const [saved, setSaved] = useState(false);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      if (roleFamily) fd.append('roleFamily', roleFamily);
      const res = await fetch('/api/resumes/upload', { method: 'POST', body: fd });
      const json = (await res.json()) as UploadResponse;
      if (!res.ok) throw new Error(json.error ?? 'Upload failed.');
      const added = json.ingested?.length ?? 0;
      const failed = json.errors?.length ?? 0;
      setUploadMsg(
        `Added ${added} résumé(s)${json.extracted ? '' : ' (text only — set OPENAI_API_KEY to extract skills/bullets)'}${failed ? `; ${failed} failed.` : '.'}`,
      );
      await utils.resumes.listCorpus.invalidate();
    } catch (e) {
      setUploadMsg((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function toggleKeyword(kw: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  }

  function onExtract() {
    extractKw.mutate(
      { jdText },
      {
        onSuccess: (data) => {
          const sel = new Set<string>();
          for (const k of [...data.tech, ...data.soft]) if (k.inCorpus) sel.add(k.keyword);
          setSelected(sel);
        },
      },
    );
  }

  function onGenerate() {
    tailor.mutate(
      {
        jobTitle,
        company,
        selectedKeywords: [...selected],
        roleFamily: roleFamily || undefined,
      },
      {
        onSuccess: (data) => {
          setLatex(data.latex);
          setGenId((n) => n + 1);
          setSaved(false);
        },
      },
    );
  }

  function onSave() {
    if (!latex) return;
    const label = `${jobTitle}${company ? ` — ${company}` : ''}`.slice(0, 200) || 'Tailored résumé';
    save.mutate(
      { label, latex },
      {
        onSuccess: () => {
          setSaved(true);
          void utils.resumes.listCorpus.invalidate();
        },
      },
    );
  }

  const kwData = extractKw.data;
  const hasCorpus = (corpus.data?.resumes.length ?? 0) > 0 || (corpus.data?.bulletCount ?? 0) > 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tailoring Studio</h1>
        <p className="text-muted text-sm">
          Upload your résumés once, paste a job description, and generate a strong, keyword-complete
          one-page résumé — edit the LaTeX and preview the PDF side by side.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* Step 1 — corpus */}
        <Section step={1} title="Your résumé corpus">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.tex,.txt"
              className="text-sm"
              onChange={(e) => void handleUpload(e.target.files)}
              disabled={uploading}
            />
            {uploading && <span className="text-muted text-sm">Uploading &amp; extracting…</span>}
          </div>
          {uploadMsg && <p className="text-muted mt-2 text-xs">{uploadMsg}</p>}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-muted flex flex-1 flex-col gap-1 text-xs">
              Add skills you have (comma or newline separated)
              <textarea
                className={`${inputCls} min-h-16`}
                value={skillsText}
                onChange={(e) => setSkillsText(e.target.value)}
                placeholder="kafka, grpc, high concurrency, mentorship"
              />
            </label>
            <select
              className={inputCls}
              value={skillsKind}
              onChange={(e) => setSkillsKind(e.target.value as 'technical' | 'soft')}
            >
              <option value="technical">technical</option>
              <option value="soft">soft</option>
            </select>
            <button
              type="button"
              className={btnCls}
              disabled={addSkills.isPending || skillsText.trim() === ''}
              onClick={() =>
                addSkills.mutate(
                  {
                    skills: skillsText
                      .split(/[,\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    kind: skillsKind,
                  },
                  {
                    onSuccess: () => {
                      setSkillsText('');
                      void utils.resumes.listCorpus.invalidate();
                    },
                  },
                )
              }
            >
              Add skills
            </button>
          </div>

          <div className="text-muted mt-3 text-xs">
            {corpus.data
              ? `${corpus.data.resumes.length} résumé(s) · ${corpus.data.bulletCount} bullets · ${corpus.data.skillCount} skills`
              : 'Loading corpus…'}
          </div>
          {corpus.data && corpus.data.resumes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {corpus.data.resumes.map((r) => (
                <li
                  key={r.id}
                  className="border-border flex items-center justify-between rounded border px-2 py-1 text-sm"
                >
                  <span>
                    {r.label}{' '}
                    <span className="text-faint text-xs">
                      ({r.kind}
                      {r.roleFamily ? `, ${r.roleFamily}` : ''})
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-faint hover:text-fg text-xs"
                    onClick={() =>
                      removeResume.mutate(
                        { id: r.id },
                        { onSuccess: () => void utils.resumes.listCorpus.invalidate() },
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Step 2 — JD + keywords */}
        <Section step={2} title="Job description → keywords">
          <div className="flex flex-wrap gap-3">
            <label className="text-muted flex flex-col gap-1 text-xs">
              Job title
              <input
                className={inputCls}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Software Engineer"
              />
            </label>
            <label className="text-muted flex flex-col gap-1 text-xs">
              Company
              <input
                className={inputCls}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Stripe"
              />
            </label>
            <label className="text-muted flex flex-col gap-1 text-xs">
              Role family (retrieval lens)
              <select
                className={inputCls}
                value={roleFamily}
                onChange={(e) => setRoleFamily(e.target.value as RoleFamily | '')}
              >
                <option value="">any</option>
                {ROLE_FAMILIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            className={`${inputCls} mt-3 min-h-40 w-full`}
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here…"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className={btnCls}
              disabled={extractKw.isPending || jdText.trim() === ''}
              onClick={onExtract}
            >
              {extractKw.isPending ? 'Extracting…' : 'Extract keywords'}
            </button>
            {extractKw.isError && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                {extractKw.error.message}
              </span>
            )}
          </div>

          {kwData && (
            <div className="mt-4">
              <KeywordPicker
                groups={[
                  { label: 'Technical', items: kwData.tech },
                  { label: 'Soft', items: kwData.soft },
                ]}
                selected={selected}
                onToggle={toggleKeyword}
              />
            </div>
          )}
        </Section>

        {/* Step 3 — generate */}
        <Section step={3} title="Generate & preview">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primaryBtn}
              disabled={tailor.isPending || jobTitle.trim() === '' || !hasCorpus}
              onClick={onGenerate}
            >
              {tailor.isPending ? 'Generating…' : 'Generate résumé'}
            </button>
            {!hasCorpus && (
              <span className="text-muted text-xs">Upload at least one résumé first.</span>
            )}
            {selected.size > 0 && (
              <span className="text-muted text-xs">{selected.size} keyword(s) selected</span>
            )}
            {tailor.data?.source === 'base' && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                Set OPENAI_API_KEY to auto-generate — showing the base template.
              </span>
            )}
            {tailor.data && (
              <span className="text-faint text-xs">
                used {tailor.data.usedBullets} corpus bullet(s)
              </span>
            )}
          </div>

          {tailor.isError && <ErrorState message={tailor.error.message} />}

          {latex != null && (
            <div className="mt-4">
              <ResumeSplit
                key={genId}
                latex={latex}
                onLatexChange={setLatex}
                filename={`${(jobTitle || 'resume').replace(/\s+/g, '_')}${company ? `_${company.replace(/\s+/g, '_')}` : ''}`}
                onSave={onSave}
                saving={save.isPending}
                saved={saved}
              />
              {save.isError && (
                <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">
                  Save failed: {save.error.message}
                </p>
              )}
            </div>
          )}
        </Section>
      </div>
    </main>
  );
}
