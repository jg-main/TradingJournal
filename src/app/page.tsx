import { NotebookPen, TrendingUp, Target, Star } from 'lucide-react';

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Dashboard
      </h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
        Overview of your trading performance and activity.
      </p>

      {/* Quick stat cards */}
      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            <NotebookPen className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">0</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Trades</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <TrendingUp className="size-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">0%</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Win Rate</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Target className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">$0</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">P&L</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Star className="size-4 text-purple-600 dark:text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">--</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Avg Grade</p>
        </div>
      </div>

      {/* Recent activity placeholder */}
      <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Start logging trades to see your dashboard come to life.
        </p>
      </div>
    </div>
  );
}
