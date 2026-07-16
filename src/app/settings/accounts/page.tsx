'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Edit3, User, Building2, Wallet, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Settings {
  defaultAccountId: string | null;
}

type AccountForm = {
  name: string;
  broker: string;
  currency: string;
  // Retained temporarily so the existing dialog fields compile while the
  // account detail page becomes the canonical parameter surface.
  maxRiskPerTradePct?: string;
  defaultCommission?: string;
  startingBalance?: string;
};

const EMPTY_FORM: AccountForm = { name: '', broker: '', currency: 'USD' }; 

export default function AccountsSettingsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [accountsRes, settingsRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/settings'),
      ]);
      const accountsData = await accountsRes.json();
      const settingsData = await settingsRes.json();
      if (Array.isArray(accountsData)) setAccounts(accountsData);
      if (settingsData && settingsData.id) setSettings(settingsData);
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          broker: form.broker || null,
          currency: form.currency,
          // Parameters and opening cash are completed after Draft creation.
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.details ? JSON.stringify(err.details) : err.error);
        return;
      }

      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await fetchData();
    } catch {
      setError('Failed to create account.');
    } finally {
      setSaving(false);
    }
  };

  const activeAccounts = accounts.filter((a) => a.isActive);
  const inactiveAccounts = accounts.filter((a) => !a.isActive);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading accounts...</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link
          href="/settings"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>

        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Accounts
        </h1>
        <EmptyState
          icon={<User className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No accounts yet"
          description="Create your first trading account to start tracking performance."
          action={
            <Button onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true); }}>
              <Plus className="size-4" />
              Add Account
            </Button>
          }
        />
        <AccountDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          saving={saving}
          error={error}
          setError={setError}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Accounts
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Manage your brokerage accounts — click a row to view details.
          </p>
        </div>
        <Button
          onClick={() => {
            setForm(EMPTY_FORM);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Add Account
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Broker</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeAccounts.map((account) => (
              <TableRow
                key={account.id}
                className="cursor-pointer"
                onClick={() => router.push(`/accounts/${account.id}`)}
              >
                <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">
                  <div className="flex items-center gap-2">
                    {account.name}
                    {settings?.defaultAccountId === account.id && (
                      <Badge variant="secondary" className="text-[10px]">
                        Default
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-zinc-500">
                  {account.broker ? (
                    <span className="flex items-center gap-1.5">
                      <Building2 className="size-3.5" />
                      {account.broker}
                    </span>
                  ) : (
                    <span className="text-zinc-400">&mdash;</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                    <Wallet className="size-3.5" />
                    {account.currency}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={account.isActive ? 'default' : 'secondary'} className="text-[10px]">
                    {account.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {inactiveAccounts.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            Inactive accounts ({inactiveAccounts.length})
          </summary>
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <Table>
              <TableBody>
                {inactiveAccounts.map((account) => (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/accounts/${account.id}`)}
                  >
                    <TableCell className="font-medium text-zinc-500">
                      {account.name}
                    </TableCell>
                    <TableCell className="text-zinc-400">{account.broker ?? '\u2014'}</TableCell>
                    <TableCell className="text-zinc-400">{account.currency}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        Inactive
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}

      <AccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        onSave={handleSave}
        saving={saving}
        error={error}
        setError={setError}
      />
    </div>
  );
}

function AccountDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  saving,
  error,
  setError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: AccountForm;
  setForm: (f: AccountForm) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const isValid = form.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
          <DialogDescription>
            Create a new brokerage account to track trades and performance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="account-name" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Account Name
            </label>
            <Input
              id="account-name"
              placeholder="e.g. Main Brokerage"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="account-broker" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Broker
            </label>
            <Input
              id="account-broker"
              placeholder="e.g. Interactive Brokers"
              value={form.broker}
              onChange={(e) => setForm({ ...form, broker: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="account-currency" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Currency
            </label>
            <Input
              id="account-currency"
              placeholder="USD"
              maxLength={3}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className="w-24"
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Create a Draft account first. Set risk parameters and post opening cash from its account page.
          </p>

          <hr className="hidden border-zinc-200 dark:border-zinc-700" />

          <div className="hidden">
            <label htmlFor="account-max-risk" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Max Risk Per Trade (%)
            </label>
            <Input
              id="account-max-risk"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="e.g. 2"
              value={form.maxRiskPerTradePct}
              onChange={(e) => setForm({ ...form, maxRiskPerTradePct: e.target.value })}
            />
          </div>

          <div className="hidden">
            <label htmlFor="account-default-commission" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Default Commission ($)
            </label>
            <Input
              id="account-default-commission"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 0.50"
              value={form.defaultCommission}
              onChange={(e) => setForm({ ...form, defaultCommission: e.target.value })}
            />
          </div>

          <div className="hidden">
            <label htmlFor="account-starting-balance" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Starting Balance ($)
            </label>
            <Input
              id="account-starting-balance"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 50000"
              value={form.startingBalance}
              onChange={(e) => setForm({ ...form, startingBalance: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setError(null); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!isValid || saving}>
            {saving ? 'Saving...' : 'Add Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
