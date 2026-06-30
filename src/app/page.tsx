export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-black dark:to-zinc-900">
      <main className="flex flex-col items-center gap-6 text-center px-4">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Trading Journal
        </h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
          Track, analyze, and improve your trading performance with structured
          journaling and process-driven reviews.
        </p>
        <div className="flex gap-3 text-sm">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            Database connected
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            v0.1.0
          </span>
        </div>
      </main>
    </div>
  );
}
