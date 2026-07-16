import { redirect } from 'next/navigation';

/**
 * Legacy settings account detail redirect.
 *
 * The /settings/accounts/[id] path is now served by /accounts/[id]/settings.
 * This page performs a server-side 307 (temporary) redirect so existing
 * bookmarks, browser history, and account-list deep links continue to work
 * without a client-only flash.
 */
export default async function LegacyAccountRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/accounts/${id}/settings`);
}
