/** Small neutral tag used for role family, seniority, employment type, etc. */
export function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`bg-surface-2 inline-block rounded px-1.5 py-0.5 text-xs ${
        muted ? 'text-faint' : 'text-muted'
      }`}
    >
      {children}
    </span>
  );
}
