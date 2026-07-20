'use client';

import { use } from 'react';
import AccountLedger from '@/components/accounting/account-ledger';

// ── Page Component ─────────────────────────────────────────────────────

/**
 * Account Ledger Page.
 *
 * Deep-linked workspace at /accounts/[id]/ledger showing the full financial
 * event ledger with category filtering, pagination, expandable posting pairs,
 * and grouped correction lineage. Uses the GET /api/accounts/[id]/ledger
 * endpoint.
 *
 * The layout (layout.tsx) provides the shared account header, back link, and
 * workspace tab navigation.
 */
export default function AccountLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AccountLedger accountId={id} />;
}
