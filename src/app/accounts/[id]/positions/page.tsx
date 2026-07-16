'use client';

import { use } from 'react';
import AccountPositions from '@/components/accounting/account-positions';

// ── Page Component ─────────────────────────────────────────────────────

/**
 * Account Positions Page.
 *
 * Deep-linked workspace at /accounts/[id]/positions showing the full
 * positions workspace with dense summary strip, expandable FIFO lots,
 * and proper missing-price/null-mark states.
 *
 * The layout (layout.tsx) provides the shared account header, back link,
 * and workspace tab navigation (Overview, Ledger, Positions,
 * Reconciliation, Settings).
 *
 * The Positions tab is highlighted when this page is active.
 */
export default function AccountPositionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AccountPositions accountId={id} />;
}
