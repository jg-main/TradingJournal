import "./workstation.css";

// Workspace layout: applies the `.ws` density scope so every workstation
// panel inherits compact rows, tabular numerals, and fine borders. No
// sidebar, no legacy chrome — the workstation owns the full viewport.
export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="ws">{children}</div>;
}
