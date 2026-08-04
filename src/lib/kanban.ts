/**
 * Group tracker applications into kanban columns in a single pass. Any status
 * outside the four pipeline columns (e.g. saved/withdrawn) collects in a
 * trailing "Other" column, which is omitted when empty. Pure and testable.
 */
export const KANBAN_COLUMNS = [
  { key: 'applied', label: 'Applied' },
  { key: 'interviewing', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'rejected', label: 'Rejected' },
] as const;

export type KanbanColumnKey = (typeof KANBAN_COLUMNS)[number]['key'] | 'other';

export interface KanbanColumn<T> {
  key: KanbanColumnKey;
  label: string;
  apps: T[];
}

export function groupByColumn<T extends { status: string }>(apps: T[]): KanbanColumn<T>[] {
  const buckets = new Map<string, T[]>(KANBAN_COLUMNS.map((c) => [c.key, [] as T[]]));
  const other: T[] = [];
  for (const app of apps) {
    (buckets.get(app.status) ?? other).push(app);
  }
  const columns: KanbanColumn<T>[] = KANBAN_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    apps: buckets.get(c.key) ?? [],
  }));
  if (other.length > 0) columns.push({ key: 'other', label: 'Other', apps: other });
  return columns;
}
