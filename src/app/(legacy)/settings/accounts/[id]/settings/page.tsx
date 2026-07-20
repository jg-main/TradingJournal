'use client';

import { use } from 'react';
import AccountSettings from '@/components/accounting/account-settings';

/**
 * Account Settings page.
 *
 * Renders the focused account identity and trading defaults editor inside
 * the shared account workspace shell (layout.tsx provides the header,
 * back link, and tab navigation).
 */
export default function AccountSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AccountSettings accountId={id} />;
}
