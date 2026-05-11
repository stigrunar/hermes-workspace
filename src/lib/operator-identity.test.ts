import { describe, expect, it } from 'vitest'
import {
  fallbackOperatorDisplayName,
  formatOperatorIdentity,
  formatOperatorRoleBadge,
} from './operator-identity'

describe('operator identity helpers', () => {
  it('formats canonical swarm and operations labels as <displayName> · <id>', () => {
    expect(formatOperatorIdentity('Control Mirror', 'swarm3')).toBe('Control Mirror · swarm3')
    expect(formatOperatorIdentity(undefined, 'dollycode')).toBe('DollyCode · dollycode')
    expect(formatOperatorIdentity(undefined, 'default')).toBe('Dolly Main · default')
  })

  it('provides safe fallback display names for profile ids', () => {
    expect(fallbackOperatorDisplayName('swarm8')).toBe('Swarm8')
    expect(fallbackOperatorDisplayName('dolly')).toBe('Dolly Legacy')
    expect(fallbackOperatorDisplayName('custom-agent')).toBe('Custom Agent')
  })

  it('normalizes role badges for compact UI chips', () => {
    expect(formatOperatorRoleBadge('Swarm Control Plane Main-Session Mirror')).toBe(
      'Swarm Control Plane Main Session Mirror',
    )
    expect(formatOperatorRoleBadge('')).toBe('Worker')
  })
})