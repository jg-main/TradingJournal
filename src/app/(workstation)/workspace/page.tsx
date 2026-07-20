// /workspace — greenfield workstation entry point.
//
// T01 ships the route shell only: the layout group, density tokens, and a
// minimal placeholder proving the route renders isolated from the legacy
// dashboard. T03 replaces this page with the full WorkstationShell (CSS
// Grid, WorkstationContext, toolbar).
export default function WorkspacePage() {
  return (
    <>
      <header
        style={{ height: "var(--ws-toolbar-h)" }}
        className="flex items-center gap-2 border-b border-border px-3 text-sm"
      >
        <span className="font-semibold">Workstation</span>
        <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Shell
        </span>
      </header>
      <main className="ws-mono flex-1 p-2 text-muted-foreground">
        Workstation shell placeholder — grid panels arrive in T03.
      </main>
    </>
  );
}
