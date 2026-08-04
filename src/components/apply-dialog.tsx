'use client';

import { useEffect, useRef } from 'react';

/**
 * Confirmation shown after the user opens a posting to apply: "did you apply?".
 * A minimal accessible modal — Escape + backdrop close, Tab is trapped inside,
 * focus starts on the dismissive action and is restored to the trigger on close.
 * Stays open until the caller's write settles so a failure is visible.
 */
export function ApplyDialog({
  company,
  title,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  company: string;
  title: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const items = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className="border-border bg-surface w-full max-w-md rounded-lg border p-5 shadow-lg"
      >
        <h2 id="apply-dialog-title" className="text-lg font-semibold">
          Did you apply?
        </h2>
        <p className="text-muted mt-1 text-sm">
          We opened the application for <span className="font-medium">{title}</span> at{' '}
          <span className="font-medium">{company}</span> in a new tab. Once you’ve submitted it,
          confirm below and it moves to your tracker.
        </p>
        {error && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Couldn’t save: {error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="border-border hover:bg-surface-2 rounded-md border px-3 py-1 text-sm font-medium"
          >
            Not yet
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="rounded-md border border-green-600 bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Yes, I applied'}
          </button>
        </div>
      </div>
    </div>
  );
}
