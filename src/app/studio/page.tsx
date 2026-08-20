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
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/page-state';
import { ResumeSplit } from '@/components/resume-split';
import { TailoringReport } from '@/components/tailoring-report';
import { ROLE_FAMILIES, type RoleFamily } from '@/lib/role-families';
import { trpc } from '@/trpc/react';

const inputCls =
  'rounded-md border border-border bg-surface px-2 py-1 text-sm focus:border-brand focus:outline-none';
const btnCls =
  'press rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50';
const primaryBtn = `press rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-brand-contrast shadow-[0_8px_24px_-8px_var(--color-brand)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0`;

interface UploadResponse {
  ingested?: Array<{ label: string; resumeId: number; skills: number; bullets: number }>;
  errors?: Array<{ file: string; error: string }>;
  extracted?: boolean;
  error?: string;
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="border-border bg-surface animate-rise rounded-xl border p-5"
      style={{ animationDelay: `${step * 70}ms` }}
    >
      <div className="mb-4 flex items-baseline gap-3">
        <span className="bg-brand/12 text-brand-text font-display inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {step}
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-faint mt-0.5 text-xs">{hint}</p>}
        </div>
      </div>
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
  const [dragActive, setDragActive] = useState(false);
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

  const ACCEPTED = ['.pdf', '.tex', '.txt'];

  /** POST a single résumé; resolves to a per-file outcome, never throws. */
  async function uploadOne(
    file: File,
  ): Promise<{ ok: boolean; error?: string; textOnly?: boolean }> {
    const fd = new FormData();
    fd.append('files', file);
    if (roleFamily) fd.append('roleFamily', roleFamily);
    try {
      const res = await fetch('/api/resumes/upload', { method: 'POST', body: fd });
      // A killed serverless function returns no body at all, so parsing is
      // allowed to fail without turning into an unhelpful "fetch failed".
      const json = (await res.json().catch(() => ({}))) as UploadResponse;
      if (!res.ok) return { ok: false, error: json.error ?? `Upload failed (HTTP ${res.status}).` };
      const failure = json.errors?.[0];
      if (failure) return { ok: false, error: failure.error };
      if (!json.ingested?.length) return { ok: false, error: 'Nothing was ingested.' };
      return { ok: true, textOnly: json.extracted === false };
    } catch {
      return {
        ok: false,
        error: 'The server closed the connection — the résumé may be too long to process.',
      };
    }
  }

  /**
   * Upload sequentially, one request per file. Batching them into a single
   * request meant one slow résumé could time the whole invocation out and lose
   * the files that had already succeeded; now each file stands alone and a
   * failure part-way through keeps everything before it.
   */
  async function handleUpload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploading(true);
    setUploadMsg(null);

    const failures: string[] = [];
    let added = 0;
    let textOnly = false;

    for (const [i, file] of list.entries()) {
      setUploadMsg(
        list.length > 1
          ? `Uploading ${i + 1} of ${list.length}: ${file.name}…`
          : `Uploading ${file.name}…`,
      );
      const result = await uploadOne(file);
      if (result.ok) {
        added++;
        textOnly ||= result.textOnly ?? false;
        // Refresh as we go so completed résumés appear even if a later one fails.
        await utils.resumes.listCorpus.invalidate();
      } else {
        failures.push(`${file.name}: ${result.error}`);
      }
    }

    const parts: string[] = [];
    if (added > 0) {
      parts.push(
        `Added ${added} résumé${added === 1 ? '' : 's'}${
          textOnly ? ' (text only — set OPENAI_API_KEY to extract skills/bullets)' : ''
        }.`,
      );
    }
    if (failures.length > 0) parts.push(`Failed — ${failures.join('; ')}`);
    setUploadMsg(parts.join(' ') || 'Nothing was uploaded.');

    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (uploading) return;
    const dropped = Array.from(e.dataTransfer.files);
    const accepted = dropped.filter((f) =>
      ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (accepted.length === 0) {
      setUploadMsg('Only PDF, .tex, or .txt files are accepted.');
      return;
    }
    void handleUpload(accepted);
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
      <PageHeader
        eyebrow="Résumé studio"
        title="Tailoring Studio"
        subtitle="Upload your résumés once, paste a job description, and generate a strong, keyword-complete one-page résumé — edit the LaTeX and watch the PDF update side by side."
      />

      <div className="flex flex-col gap-5">
        {/* Step 1 — corpus */}
        <Section
          step={1}
          title="Your résumé corpus"
          hint="The more real résumés you add, the sharper every tailor gets."
        >
          <label
            onDragEnter={(e) => {
              e.preventDefault();
              if (!uploading) setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragActive
                ? 'border-brand bg-brand/5'
                : 'border-border bg-surface-2 hover:bg-surface-2/70'
            } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.tex,.txt"
              className="sr-only"
              onChange={(e) => void handleUpload(e.target.files)}
              disabled={uploading}
            />
            <span className="text-fg text-sm font-medium">
              {uploading ? 'Uploading & extracting…' : 'Drag & drop résumés here'}
            </span>
            <span className="text-faint text-xs">
              or click to browse — PDF, .tex, or .txt (up to 10 files)
            </span>
          </label>
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

          {corpus.data && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  ['résumés', corpus.data.resumes.length],
                  ['bullets', corpus.data.bulletCount],
                  ['skills', corpus.data.skillCount],
                ] as const
              ).map(([label, n]) => (
                <span
                  key={label}
                  className="bg-surface-2 border-border inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-xs"
                >
                  <span className="text-fg font-display text-sm font-semibold tabular-nums">
                    {n}
                  </span>
                  <span className="text-muted">{label}</span>
                </span>
              ))}
            </div>
          )}

          {corpus.data && corpus.data.resumes.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="Your corpus is empty — that's the only setup step.">
                Drop in a few past résumés (PDF, .tex, or .txt) above. The AI mines them for real
                bullets and skills, then rewrites them for each job. More résumés → sharper
                tailoring.
              </EmptyState>
            </div>
          ) : (
            corpus.data && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {corpus.data.resumes.map((r) => (
                  <li
                    key={r.id}
                    className="border-border bg-surface lift flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="truncate">
                      {r.label}{' '}
                      <span className="text-faint text-xs">
                        ({r.kind}
                        {r.roleFamily ? `, ${r.roleFamily}` : ''})
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-faint text-xs transition-colors hover:text-rose-500"
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
            )
          )}
        </Section>

        {/* Step 2 — JD + keywords */}
        <Section
          step={2}
          title="Job description → keywords"
          hint="Paste the JD, then tick the tech + soft keywords to weave in."
        >
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
        <Section step={3} title="Generate & preview" hint="One page, ATS-ready, yours to edit.">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primaryBtn}
              disabled={tailor.isPending || jobTitle.trim() === '' || !hasCorpus}
              onClick={onGenerate}
            >
              {tailor.isPending ? 'Tailoring your résumé…' : '✦ Generate résumé'}
            </button>
            {!hasCorpus && (
              <span className="text-muted text-xs">Upload at least one résumé first.</span>
            )}
            {selected.size > 0 && !tailor.isPending && (
              <span className="text-muted text-xs">{selected.size} keyword(s) selected</span>
            )}
          </div>

          {/* Celebratory confirmation once a résumé comes back. */}
          {tailor.data && latex != null && (
            <div
              className="animate-celebrate border-brand/30 bg-brand/8 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
              role="status"
            >
              <span className="text-brand-text font-medium">
                {tailor.data.source === 'llm'
                  ? '✦ Résumé ready — tailored to this JD.'
                  : 'Draft ready from your base template.'}
              </span>
              <span className="text-muted text-xs">
                {selected.size} keyword(s) woven in · {tailor.data.usedBullets} real bullet(s) drawn
                on{tailor.data.report ? ` · ${tailor.data.report.lint.wordCount} words` : ''}
              </span>
              {tailor.data.source === 'base' && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  (Set a tailoring key to auto-generate — showing the base template.)
                </span>
              )}
            </div>
          )}

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
              {tailor.data?.report && (
                <TailoringReport
                  latex={latex}
                  keywords={tailor.data.report.selectedKeywords}
                  masterSkills={tailor.data.report.masterSkills}
                />
              )}
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
