'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Landmark } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import DynamicTable from '@/components/dynamic-table';
import { EmptyState } from '@/components/empty-state';
import { AddAccountDialog, type CreatedAccount } from '@/components/accounting/add-account-dialog';
import { useAccount } from '@/lib/account-context';

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AccountsPage() {
  const router = useRouter();
  useEffect(() => { document.title = "Accounts — Trading Journal"; }, []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [persistedDefaultAccountId, setPersistedDefaultAccountId] = useState<string | null>(null);
  const [defaultAccountDraft, setDefaultAccountDraft] = useState('');
  const [defaultSettingsStatus, setDefaultSettingsStatus] = useState<'ready' | 'unavailable'>('unavailable');
  const [savingDefault, setSavingDefault] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { refresh, setAccountId } = useAccount();

  const fetchAccounts = async () => {
    try {
      const [accountsResult, settingsResult] = await Promise.allSettled([
        fetch('/api/accounts'),
        fetch('/api/settings'),
      ]);

      if (accountsResult.status === 'rejected' || !accountsResult.value.ok) {
        setAccounts([]);
        setMessage({ type: 'error', text: 'Failed to load accounts.' });
      } else {
        const accountsData: unknown = await accountsResult.value.json();
        if (Array.isArray(accountsData)) {
          setAccounts(accountsData);
        } else {
          setAccounts([]);
          setMessage({ type: 'error', text: 'The server returned invalid account data.' });
        }
      }

      if (settingsResult.status === 'rejected' || !settingsResult.value.ok) {
        setDefaultSettingsStatus('unavailable');
      } else {
        const settingsData: unknown = await settingsResult.value.json();
        if (settingsData && typeof settingsData === 'object') {
          const candidate = settingsData as Record<string, unknown>;
          const value = candidate.defaultAccountId;
          const noSettingsRow = typeof candidate.message === 'string' && value === undefined;

          if (value === null || typeof value === 'string' || noSettingsRow) {
            const defaultAccountId = typeof value === 'string' ? value : null;
            setPersistedDefaultAccountId(defaultAccountId);
            setDefaultAccountDraft(defaultAccountId ?? '');
            setDefaultSettingsStatus('ready');
          } else {
            setDefaultSettingsStatus('unavailable');
          }
        } else {
          setDefaultSettingsStatus('unavailable');
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load accounts.' });
      setDefaultSettingsStatus('unavailable');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAccounts(); }, []);

  const handleAccountCreated = async (account: CreatedAccount, warning?: string) => {
    setMessage({ type: warning ? 'error' : 'success', text: warning ?? `Account "${account.name}" created.` });
    // Refresh the shared account list and select the new account so the
    // sidebar and workspace see it immediately, then transition into the
    // new account workspace. Refresh errors surface through the
    // AccountProvider error state (with a retry option in the sidebar).
    try {
      await refresh();
    } catch {
      // loadAccounts absorbs failures; nothing to do here.
    }
    setAccountId(account.id);
    router.push(`/settings/accounts/${account.id}`);
  };

  const handleDefaultAccountSave = async () => {
    setSavingDefault(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAccountId: defaultAccountDraft || null }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const errorData = data && typeof data === 'object'
          ? data as Record<string, unknown>
          : null;
        const details = errorData?.details;
        const text = typeof errorData?.error === 'string'
          ? errorData.error
          : typeof details === 'string'
            ? details
            : 'Failed to save the default account.';
        setMessage({ type: 'error', text });
        return;
      }

      if (!data || typeof data !== 'object') {
        setMessage({ type: 'error', text: 'The server returned an invalid settings response.' });
        return;
      }

      const value = (data as Record<string, unknown>).defaultAccountId;
      if (value !== null && typeof value !== 'string') {
        setMessage({ type: 'error', text: 'The server returned an invalid settings response.' });
        return;
      }

      setPersistedDefaultAccountId(value);
      setDefaultAccountDraft(value ?? '');
      setDefaultSettingsStatus('ready');
      setMessage({ type: 'success', text: 'Default account saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save the default account.' });
    } finally {
      setSavingDefault(false);
    }
  };

  // ── Column definitions ─────────────────────────────────────────────

  const columns = useMemo<ColumnDef<Account>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => (
        <span className="font-semibold text-foreground">
          {row.original.name}
          {persistedDefaultAccountId === row.original.id && (
            <span className="ml-2 inline-block rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
              Default
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'broker',
      header: 'Broker',
      accessorKey: 'broker',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string | null>() ?? '—'}</span>,
    },
    {
      id: 'currency',
      header: 'Currency',
      accessorKey: 'currency',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'isActive',
      cell: ({ getValue }) => {
        const active = getValue<boolean>();
        return (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
              active
                ? 'bg-positive/10 text-positive'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {active ? 'Active' : 'Inactive'}
          </span>
        );
      },
    },
  ], [persistedDefaultAccountId]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading && accounts.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
        <p className="text-sm text-muted-foreground">Loading accounts...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-8 sm:py-10">
      {/* Back link */}
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Accounts</h1>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Landmark className="size-4" />+ Add Account
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Default account section */}
      <section
        aria-labelledby="default-account-heading"
        className="mb-8 rounded-lg border bg-card p-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 id="default-account-heading" className="text-sm font-semibold text-foreground">
              Default account
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              New trades use this account unless you choose another one.
            </p>
            <label htmlFor="default-account" className="mt-4 mb-1.5 block text-sm font-medium text-foreground">
              Account used by default
            </label>
            <select
              id="default-account"
              value={defaultAccountDraft}
              onChange={(event) => setDefaultAccountDraft(event.target.value)}
              aria-describedby="default-account-status"
              className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">No default account</option>
              {accounts.filter((account) => account.isActive).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
              {persistedDefaultAccountId &&
                !accounts.some((account) => account.id === persistedDefaultAccountId && account.isActive) && (
                  <option value={persistedDefaultAccountId} disabled>
                    Current default is inactive or unavailable
                  </option>
                )}
            </select>
            <p id="default-account-status" className="mt-2 text-xs text-muted-foreground" role="status">
              {defaultSettingsStatus === 'unavailable'
                ? 'Saved default unavailable. Choose an account and save to retry.'
                : persistedDefaultAccountId
                  ? `Saved default: ${accounts.find((account) => account.id === persistedDefaultAccountId)?.name ?? 'Unavailable account'}`
                  : 'No default account is saved.'}
              {defaultSettingsStatus === 'ready' && defaultAccountDraft !== (persistedDefaultAccountId ?? '')
                ? ' Selection not saved.'
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDefaultAccountSave}
            disabled={savingDefault}
            className="min-h-10 shrink-0 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingDefault ? 'Saving default...' : 'Save default'}
          </button>
        </div>
      </section>

      {/* Add account dialog — creates the account, optionally sets it as the
          default, refreshes shared account state, and navigates into the new
          account workspace. */}
      <AddAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleAccountCreated}
      />

      {/* Table */}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark className="size-12 text-muted-foreground" strokeWidth={1} />}
          title="No accounts yet"
          description="Add your first brokerage account to get started."
        />
      ) : (
        <DynamicTable
          data={accounts}
          columns={columns}
          storageKey="accounts"
          onRowClick={row => router.push('/settings/accounts/' + row.original.id)}
          rowHref={row => `/settings/accounts/${row.original.id}`}
          rowLinkColumnId="name"
          rowLinkLabel={row => `Open account ${row.original.name}`}
        />
      )}
    </div>
  );
}
