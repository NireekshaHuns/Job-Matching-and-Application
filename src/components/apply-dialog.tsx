'use client';

import { useEffect } from 'react';

/**
 * Confirmation shown after the user opens a posting to apply: "did you apply?".
 * A minimal accessible modal (Escape + backdrop close, focus on confirm). On
 * confirm the caller records the application; on dismiss nothing happens.
 */
export function ApplyDialog({
  company,
  title,
  pending,
  onConfirm,
  onClose,
}: {
  company: string;
  title: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Did you apply to ${company}?`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-lg">
        <h2 className="text-lg font-semibold">Did you apply?</h2>
        <p className="mt-1 text-sm text-zinc-600">
          We opened the application for <span className="font-medium">{title}</span> at{' '}
          <span className="font-medium">{company}</span> in a new tab. Once you’ve submitted it,
          confirm below and it moves to your tracker.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50"
          >
            Not yet
          </button>
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onConfirm}
            className="rounded-md border border-green-600 bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Yes, I applied
          </button>
        </div>
      </div>
    </div>
  );
}
