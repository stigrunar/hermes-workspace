import type { StudioSettings } from '@/hooks/use-settings'
import type { ProviderStatus } from '@/server/provider-usage'

export const MATRIX_BUDGET_ENV_KEYS = {
  advisorySpendLimitUsd: ['VITE_MATRIX_BUDGET_LIMIT_USD', 'MATRIX_BUDGET_LIMIT_USD'],
  advisorySpendWarningUsd: ['VITE_MATRIX_BUDGET_WARNING_USD', 'MATRIX_BUDGET_WARNING_USD'],
  advisoryContextLimitPercent: ['VITE_MATRIX_CONTEXT_LIMIT_PERCENT', 'MATRIX_CONTEXT_LIMIT_PERCENT'],
  scopeLabel: ['VITE_MATRIX_BUDGET_SCOPE_LABEL', 'MATRIX_BUDGET_SCOPE_LABEL'],
} as const

export const MATRIX_BUDGET_ENFORCEMENT_HOOK = '/api/swarm-dispatch'

export type MatrixBudgetConfig = {
  scopeLabel: string
  preferredBudgetModel: string | null
  advisorySpendLimitUsd: number | null
  advisorySpendWarningUsd: number | null
  advisoryContextLimitPercent: number
  usageWarningPercent: number
  enforcementMode: 'advisory'
  nextEnforcementHook: string
  sources: Array<string>
}

export type MatrixProviderStatus = {
  provider: string
  displayName: string
  status: ProviderStatus
  message?: string
}

export type MatrixSpendSnapshot = {
  estimatedCostUsd: number | null
  costLabel: 'precise' | 'partial' | 'included' | 'unknown'
}

export type MatrixBudgetSummary = {
  estimatedSpendUsd: number | null
  spendState: 'unknown' | 'ok' | 'warning' | 'limit'
  costLabel: MatrixSpendSnapshot['costLabel']
  contextState: 'ok' | 'warning' | 'limit'
  providerState: 'ok' | 'warning'
  providerWarnings: Array<MatrixProviderStatus>
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readFiniteNumber(value)
  return parsed != null && parsed > 0 ? parsed : null
}

function readPercent(value: unknown, fallback: number): number {
  const parsed = readFiniteNumber(value)
  if (parsed == null) return fallback
  return Math.min(100, Math.max(1, parsed))
}

function firstEnvValue(env: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function resolveMatrixBudgetConfig(
  settings: Pick<StudioSettings, 'usageThreshold' | 'preferredBudgetModel'>,
  env: Record<string, unknown> = {},
): MatrixBudgetConfig {
  const advisorySpendLimitUsd = readPositiveNumber(
    firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.advisorySpendLimitUsd),
  )
  const advisorySpendWarningUsd = readPositiveNumber(
    firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.advisorySpendWarningUsd),
  )
  const advisoryContextLimitPercent = readPercent(
    firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.advisoryContextLimitPercent),
    settings.usageThreshold,
  )
  const scopeLabel =
    firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.scopeLabel) ?? 'This Matrix cockpit'

  const sources = ['settings:usageThreshold', 'settings:preferredBudgetModel']
  if (advisorySpendLimitUsd != null) sources.push(MATRIX_BUDGET_ENV_KEYS.advisorySpendLimitUsd[0])
  if (advisorySpendWarningUsd != null) sources.push(MATRIX_BUDGET_ENV_KEYS.advisorySpendWarningUsd[0])
  if (firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.advisoryContextLimitPercent)) {
    sources.push(MATRIX_BUDGET_ENV_KEYS.advisoryContextLimitPercent[0])
  }
  if (firstEnvValue(env, MATRIX_BUDGET_ENV_KEYS.scopeLabel)) {
    sources.push(MATRIX_BUDGET_ENV_KEYS.scopeLabel[0])
  }

  return {
    scopeLabel,
    preferredBudgetModel: settings.preferredBudgetModel.trim() || null,
    advisorySpendLimitUsd,
    advisorySpendWarningUsd,
    advisoryContextLimitPercent,
    usageWarningPercent: settings.usageThreshold,
    enforcementMode: 'advisory',
    nextEnforcementHook: MATRIX_BUDGET_ENFORCEMENT_HOOK,
    sources,
  }
}

export function summarizeMatrixBudget(input: {
  contextPercent: number
  spend: MatrixSpendSnapshot
  providers: Array<MatrixProviderStatus>
  config: MatrixBudgetConfig
}): MatrixBudgetSummary {
  let spendState: MatrixBudgetSummary['spendState'] = 'unknown'
  if (input.spend.estimatedCostUsd != null) {
    if (
      input.config.advisorySpendLimitUsd != null &&
      input.spend.estimatedCostUsd >= input.config.advisorySpendLimitUsd
    ) {
      spendState = 'limit'
    } else if (
      input.config.advisorySpendWarningUsd != null &&
      input.spend.estimatedCostUsd >= input.config.advisorySpendWarningUsd
    ) {
      spendState = 'warning'
    } else {
      spendState = 'ok'
    }
  }

  const providerWarnings = input.providers.filter((provider) => provider.status !== 'ok')
  const contextState: MatrixBudgetSummary['contextState'] =
    input.contextPercent >= input.config.advisoryContextLimitPercent
      ? 'limit'
      : input.contextPercent >= input.config.usageWarningPercent
        ? 'warning'
        : 'ok'

  return {
    estimatedSpendUsd: input.spend.estimatedCostUsd,
    spendState,
    costLabel: input.spend.costLabel,
    contextState,
    providerState: providerWarnings.length > 0 ? 'warning' : 'ok',
    providerWarnings,
  }
}

export function formatUsd(value: number | null): string {
  if (value == null) return 'Unavailable'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 3,
  }).format(value)
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

export function formatCostLabel(label: MatrixSpendSnapshot['costLabel']): string {
  switch (label) {
    case 'precise':
      return 'precise'
    case 'partial':
      return 'partial coverage'
    case 'included':
      return 'subscription / included'
    default:
      return 'unknown coverage'
  }
}
