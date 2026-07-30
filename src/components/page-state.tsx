'use client';

/** Shared query-state UI so the board, tracker, and dashboard read consistently. */

/** Pulsing placeholder cards shown while a query is loading. */
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50" />
      ))}
    </div>
  );
}

/** Error panel with an optional Retry that re-runs the failed query. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Friendly empty state with a title and optional supporting content. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {children && <div className="mt-1 text-sm text-zinc-500">{children}</div>}
    </div>
  );
}
