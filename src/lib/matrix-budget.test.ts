import { describe, expect, it } from 'vitest'
import {
  formatCostLabel,
  formatPercent,
  formatTokenCount,
  formatUsd,
  resolveMatrixBudgetConfig,
  summarizeMatrixBudget,
} from './matrix-budget'

describe('matrix-budget', () => {
  it('resolves advisory config from settings and env overrides', () => {
    const config = resolveMatrixBudgetConfig(
      {
        usageThreshold: 78,
        preferredBudgetModel: 'gpt-4.1-mini',
      },
      {
        VITE_MATRIX_BUDGET_LIMIT_USD: '20',
        VITE_MATRIX_BUDGET_WARNING_USD: '12.5',
        VITE_MATRIX_CONTEXT_LIMIT_PERCENT: '92',
        VITE_MATRIX_BUDGET_SCOPE_LABEL: 'Ops board',
      },
    )

    expect(config).toMatchObject({
      scopeLabel: 'Ops board',
      preferredBudgetModel: 'gpt-4.1-mini',
      advisorySpendLimitUsd: 20,
      advisorySpendWarningUsd: 12.5,
      advisoryContextLimitPercent: 92,
      usageWarningPercent: 78,
      enforcementMode: 'advisory',
      nextEnforcementHook: '/api/swarm-dispatch',
    })
    expect(config.sources).toContain('VITE_MATRIX_BUDGET_LIMIT_USD')
    expect(config.sources).toContain('VITE_MATRIX_BUDGET_SCOPE_LABEL')
  })

  it('summarizes warning states for spend, context, and provider auth', () => {
    const config = resolveMatrixBudgetConfig(
      {
        usageThreshold: 75,
        preferredBudgetModel: '',
      },
      {
        VITE_MATRIX_BUDGET_LIMIT_USD: '10',
        VITE_MATRIX_BUDGET_WARNING_USD: '6',
        VITE_MATRIX_CONTEXT_LIMIT_PERCENT: '90',
      },
    )

    const summary = summarizeMatrixBudget({
      contextPercent: 91,
      spend: {
        estimatedCostUsd: 6.8,
        costLabel: 'partial',
      },
      providers: [
        {
          provider: 'claude',
          displayName: 'Claude',
          status: 'auth_expired',
          message: 'Run claude to log in again.',
        },
        {
          provider: 'openai',
          displayName: 'OpenAI',
          status: 'ok',
        },
      ],
      config,
    })

    expect(summary).toMatchObject({
      spendState: 'warning',
      contextState: 'limit',
      providerState: 'limit',
      costLabel: 'partial',
      estimatedSpendUsd: 6.8,
    })
    expect(summary.providerWarnings).toHaveLength(1)
    expect(summary.providerWarnings[0]?.provider).toBe('claude')
    expect(summary.providerQuota.action).toContain('Fix provider auth')
  })

  it('summarizes remaining provider quota from active provider usage lines', () => {
    const config = resolveMatrixBudgetConfig(
      {
        usageThreshold: 75,
        preferredBudgetModel: '',
      },
      {},
    )

    const summary = summarizeMatrixBudget({
      contextPercent: 12,
      spend: {
        estimatedCostUsd: null,
        costLabel: 'included',
      },
      providers: [
        {
          provider: 'codex',
          displayName: 'Codex',
          status: 'ok',
          lines: [
            {
              type: 'progress',
              label: 'Codex 5h',
              used: 82,
              limit: 100,
              format: 'percent',
            },
            {
              type: 'progress',
              label: 'Codex weekly',
              used: 61,
              limit: 100,
              format: 'percent',
            },
          ],
        },
      ],
      config,
    })

    expect(summary.providerState).toBe('warning')
    expect(summary.providerQuota.remainingPercent).toBe(18)
    expect(summary.providerQuota.constrainedBy).toBe('Codex · Codex 5h')
  })

  it('formats display helpers for the cockpit', () => {
    expect(formatUsd(12.3456)).toBe('$12.35')
    expect(formatUsd(null)).toBe('Unavailable')
    expect(formatTokenCount(1450)).toBe('1.4k')
    expect(formatPercent(18.4)).toBe('18%')
    expect(formatPercent(null)).toBe('Unavailable')
    expect(formatCostLabel('included')).toBe('subscription / included')
  })
})
