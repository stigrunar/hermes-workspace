import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeUsageProviderId,
  resolveActiveUsageProviderIds,
} from './provider-usage'

const originalIncludeFallbacks =
  process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS

afterEach(() => {
  if (originalIncludeFallbacks === undefined) {
    delete process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS
  } else {
    process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS =
      originalIncludeFallbacks
  }
})

describe('provider-usage active provider selection', () => {
  it('normalizes supported usage provider aliases', () => {
    expect(normalizeUsageProviderId('openai-codex')).toBe('codex')
    expect(normalizeUsageProviderId('anthropic')).toBe('claude')
    expect(normalizeUsageProviderId('OpenRouter')).toBe('openrouter')
    expect(normalizeUsageProviderId('custom:local')).toBeNull()
  })

  it('selects only active runtime providers from config', () => {
    delete process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS

    expect(
      resolveActiveUsageProviderIds({
        model: {
          provider: 'openrouter',
          default: 'anthropic/claude-sonnet-4.5',
        },
        fallback_providers: [{ provider: 'openai-codex', model: 'gpt-5.1' }],
        auxiliary: {
          title_generation: {
            provider: 'openai',
            model: 'openai/gpt-4.1-mini',
          },
        },
      }),
    ).toEqual(['openrouter', 'claude', 'openai'])
  })

  it('does not include fallback providers unless explicitly enabled', () => {
    delete process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS
    expect(
      resolveActiveUsageProviderIds({
        model: { provider: 'openrouter' },
        fallback_providers: [{ provider: 'openai-codex' }],
      }),
    ).toEqual(['openrouter'])

    process.env.MATRIX_PROVIDER_USAGE_INCLUDE_FALLBACKS = 'true'
    expect(
      resolveActiveUsageProviderIds({
        model: { provider: 'openrouter' },
        fallback_providers: [{ provider: 'openai-codex' }],
      }),
    ).toEqual(['openrouter', 'codex'])
  })
})
