export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">H1B Job Board</h1>
      <p className="text-muted-foreground max-w-prose text-lg">
        H1B sponsorship is the organizing principle, ranked against real US government data. Every
        job shows an H1B possibility tier and a relevance score against a selected resume.
      </p>
      <p className="text-sm text-zinc-500">
        Scaffold ready. The board, tracker, outreach, and dashboard are built across Epics 1–8.
      </p>
    </main>
  );
}
