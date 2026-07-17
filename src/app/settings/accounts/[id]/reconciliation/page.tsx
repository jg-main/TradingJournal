'use client';

import { use } from 'react';
import AccountReconciliationSummary from '@/components/accounting/account-reconciliation-summary';

// ── Page Component ─────────────────────────────────────────────────────

/**
 * Account Reconciliation Page.
 *
 * Deep-linked workspace at /accounts/[id]/reconciliation showing structured
 * legacy-versus-accounting comparisons, anomaly details, computed timestamp
 * and run fingerprint, and explicit cutover eligibility. Uses the
 * GET /api/accounts/[id]/reconciliation endpoint.
 *
 * The layout (layout.tsx) provides the shared account header, back link, and
 * workspace tab navigation.
 */
export default function AccountReconciliationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AccountReconciliationSummary accountId={id} />;
}
