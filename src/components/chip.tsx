/** Small neutral tag used for role family, seniority, employment type, etc. */
export function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${
        muted ? 'bg-zinc-100 text-zinc-500' : 'bg-zinc-100 text-zinc-700'
      }`}
    >
      {children}
    </span>
  );
}
