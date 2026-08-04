/**
 * Shared query-state UI so the board, tracker, and dashboard read consistently.
 * No `'use client'`: these render only markup (any handler is passed in by the
 * client parent), so the module stays usable from server components too.
 */

/** Pulsing placeholder cards shown while a query is loading. */
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-border bg-surface-2 h-20 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}

/** Error panel with an optional Retry that re-runs the failed query. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-rose-300/60 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-rose-400/50 px-2 py-0.5 text-xs hover:bg-rose-500/10"
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
    <div className="border-border rounded-lg border border-dashed p-8 text-center">
      <p className="text-fg text-sm font-medium">{title}</p>
      {children && <div className="text-muted mt-1 text-sm">{children}</div>}
    </div>
  );
}
