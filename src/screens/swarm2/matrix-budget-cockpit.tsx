'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MatrixProviderStatus } from '@/lib/matrix-budget'
import { useSettings } from '@/hooks/use-settings'
import {
  formatCostLabel,
  formatPercent,
  formatTokenCount,
  formatUsd,
  resolveMatrixBudgetConfig,
  summarizeMatrixBudget,
} from '@/lib/matrix-budget'
import { cn } from '@/lib/utils'

type MatrixBudgetCockpitProps = {
  roomCount: number
  authErrors: number
  selectedLabel: string
  workspaceModel: string | null
  className?: string
}

type ContextUsageResponse = {
  ok?: boolean
  contextPercent?: number
  maxTokens?: number
  usedTokens?: number
  model?: string
}

type ProviderUsageEntry = {
  provider: string
  displayName: string
  status: MatrixProviderStatus['status']
  message?: string
  lines?: MatrixProviderStatus['lines']
}

type ProviderUsageResponse = {
  ok?: boolean
  providers?: Array<ProviderUsageEntry>
}

type DashboardOverviewResponse = {
  analytics?: {
    estimatedCostUsd?: number | null
    costLabel?: 'precise' | 'partial' | 'included' | 'unknown'
    windowDays?: number
  } | null
}

async function fetchContextUsage(): Promise<ContextUsageResponse> {
  const res = await fetch('/api/context-usage')
  if (!res.ok) throw new Error(`Context request failed: ${res.status}`)
  return res.json()
}

async function fetchProviderUsage(): Promise<ProviderUsageResponse> {
  const res = await fetch('/api/provider-usage')
  if (!res.ok) throw new Error(`Provider usage request failed: ${res.status}`)
  return res.json()
}

async function fetchDashboardOverview(): Promise<DashboardOverviewResponse> {
  const res = await fetch('/api/dashboard/overview?days=30')
  if (!res.ok)
    throw new Error(`Dashboard overview request failed: ${res.status}`)
  return res.json()
}

function toneClasses(state: 'ok' | 'warning' | 'limit' | 'unknown') {
  if (state === 'limit') {
    return 'border-[var(--theme-danger-border)] bg-[var(--theme-danger-soft)] text-[var(--theme-danger)]'
  }
  if (state === 'warning') {
    return 'border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] text-[var(--theme-warning)]'
  }
  if (state === 'unknown') {
    return 'border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-muted)]'
  }
  return 'border-[var(--theme-accent)]/35 bg-[var(--theme-accent-soft)] text-[var(--theme-accent-strong)]'
}

export function MatrixBudgetCockpit({
  roomCount,
  authErrors,
  selectedLabel,
  workspaceModel,
  className,
}: MatrixBudgetCockpitProps) {
  const { settings } = useSettings()
  const config = useMemo(
    () =>
      resolveMatrixBudgetConfig(
        settings,
        import.meta.env as Record<string, unknown>,
      ),
    [settings],
  )

  const contextQuery = useQuery({
    queryKey: ['matrix-budget', 'context-usage'],
    queryFn: fetchContextUsage,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  })

  const providerQuery = useQuery({
    queryKey: ['matrix-budget', 'provider-usage'],
    queryFn: fetchProviderUsage,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  })

  const overviewQuery = useQuery({
    queryKey: ['matrix-budget', 'dashboard-overview'],
    queryFn: fetchDashboardOverview,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  })

  const providerStatuses = useMemo<Array<MatrixProviderStatus>>(
    () =>
      (providerQuery.data?.providers ?? []).map((provider) => ({
        provider: provider.provider,
        displayName: provider.displayName,
        status: provider.status,
        message: provider.message,
        lines: provider.lines,
      })),
    [providerQuery.data?.providers],
  )

  const contextPercent = contextQuery.data?.contextPercent ?? 0
  const usedTokens = contextQuery.data?.usedTokens ?? 0
  const maxTokens = contextQuery.data?.maxTokens ?? 0
  const activeModel =
    contextQuery.data?.model?.trim() || workspaceModel || 'Unknown model'
  const analytics = overviewQuery.data?.analytics ?? null
  const spend = {
    estimatedCostUsd:
      typeof analytics?.estimatedCostUsd === 'number'
        ? analytics.estimatedCostUsd
        : null,
    costLabel: analytics?.costLabel ?? 'unknown',
  } as const

  const summary = useMemo(
    () =>
      summarizeMatrixBudget({
        contextPercent,
        spend,
        providers: providerStatuses,
        config,
      }),
    [config, contextPercent, providerStatuses, spend],
  )

  const providerQuotaText =
    summary.providerQuota.remainingPercent != null
      ? `${formatPercent(summary.providerQuota.remainingPercent)} remaining`
      : 'Quota unavailable'

  return (
    <section
      className={cn(
        'mt-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-left',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Matrix budget cockpit
          </div>
          <div className="mt-1 text-sm font-semibold text-[var(--theme-text)]">
            {config.scopeLabel}
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
          <span>advisory only</span>
          <span className="text-[var(--theme-muted)]/60">→</span>
          <code className="text-[var(--theme-text)]">
            {config.nextEnforcementHook}
          </code>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1">
          Rooms {roomCount}
        </span>
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1">
          Auth alerts {authErrors}
        </span>
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1">
          Focus {selectedLabel}
        </span>
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1">
          Runtime {workspaceModel || 'Unknown'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-3">
        <div
          className={cn(
            'rounded-2xl border px-3 py-2.5',
            toneClasses(summary.contextState),
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">
            Context usage
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--theme-text)]">
            {Math.round(contextPercent)}%
          </div>
          <div className="mt-1 text-xs text-[var(--theme-text)]/80">
            {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}{' '}
            tokens
          </div>
          <div className="mt-1 text-[11px] text-[var(--theme-text)]/70">
            {activeModel}
          </div>
          <div className="mt-2 text-[10px] text-[var(--theme-text)]/70">
            Warns at {config.usageWarningPercent}% · advisory cap{' '}
            {config.advisoryContextLimitPercent}%
          </div>
        </div>

        <div
          className={cn(
            'rounded-2xl border px-3 py-2.5',
            toneClasses(summary.spendState),
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">
            Spend / cost
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--theme-text)]">
            {formatUsd(summary.estimatedSpendUsd)}
          </div>
          <div className="mt-1 text-xs text-[var(--theme-text)]/80">
            30d dashboard estimate · {formatCostLabel(summary.costLabel)}
          </div>
          <div className="mt-2 text-[10px] text-[var(--theme-text)]/70">
            Warning {formatUsd(config.advisorySpendWarningUsd)} · limit{' '}
            {formatUsd(config.advisorySpendLimitUsd)}
          </div>
          <div className="mt-1 text-[10px] text-[var(--theme-text)]/70">
            Budget model{' '}
            {config.preferredBudgetModel || 'auto / provider default'}
          </div>
        </div>

        <div
          className={cn(
            'rounded-2xl border px-3 py-2.5',
            toneClasses(summary.providerState),
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">
            Provider quota
          </div>
          <div className="mt-1 text-lg font-semibold text-[var(--theme-text)]">
            {providerQuotaText}
          </div>
          <div className="mt-1 text-xs text-[var(--theme-text)]/80">
            {summary.providerQuota.constrainedBy ??
              `${providerStatuses.length} active provider${providerStatuses.length === 1 ? '' : 's'}`}
          </div>
          <div className="mt-2 text-[10px] text-[var(--theme-text)]/70">
            {summary.providerQuota.action}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-[var(--theme-text)]/75">
            {summary.providerWarnings.length > 0 ? (
              summary.providerWarnings.slice(0, 3).map((provider) => (
                <div key={provider.provider}>
                  <span className="font-medium text-[var(--theme-text)]">
                    {provider.displayName}
                  </span>
                  {provider.message
                    ? ` — ${provider.message}`
                    : ` — ${provider.status.replaceAll('_', ' ')}`}
                </div>
              ))
            ) : (
              <div>Warnings at ≤25% remaining · limit at ≤10% remaining.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--theme-muted)]">
        <span>Sources: {config.sources.join(', ')}</span>
        {contextQuery.isError ||
        providerQuery.isError ||
        overviewQuery.isError ? (
          <span className="rounded-full border border-[var(--theme-warning-border)] bg-[var(--theme-warning-soft)] px-2 py-0.5 text-[var(--theme-warning)]">
            One or more probes are degraded; unavailable values stay advisory.
          </span>
        ) : null}
      </div>
    </section>
  )
}
