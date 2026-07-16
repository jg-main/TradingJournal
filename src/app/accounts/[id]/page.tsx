'use client';

import { use } from 'react';
import AccountOverview from '@/components/accounting/account-overview';

// ── Page Component ─────────────────────────────────────────────────────

/**
 * Account Detail Page (Overview tab).
 *
 * Simplified to render only the Overview workspace content, sourcing
 * data from the GET /api/accounts/[id]/overview endpoint. The layout
 * (layout.tsx) provides the shared account header, back link, and
 * workspace tab navigation for Overview, Ledger, Positions,
 * Reconciliation, and Settings tabs.
 *
 * Loading and error states are managed by the AccountOverview component
 * with retry support for transient failures.
 */
export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AccountOverview accountId={id} />;
}
