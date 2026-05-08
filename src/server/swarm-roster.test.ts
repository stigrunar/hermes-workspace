import { describe, expect, it } from 'vitest'
import { fallbackDisplayName, fallbackRoleForWorker } from './swarm-roster'
import {
  formatSwarmIdentity,
  formatSwarmRoleBadge,
} from '../components/swarm/swarm-identity'

describe('swarm identity helpers', () => {
  it('formats display names with ids for swarm roster cards', () => {
    expect(formatSwarmIdentity('Mirror', 'swarm3')).toBe('Mirror · swarm3')
    expect(formatSwarmIdentity('', 'swarm8')).toBe('Swarm8 · swarm8')
  })

  it('uses concise role badges from canonical roles', () => {
    expect(formatSwarmRoleBadge('Swarm Control Plane Main-Session Mirror')).toBe(
      'Swarm Control Plane Main Session Mirror',
    )
    expect(formatSwarmRoleBadge('')).toBe('Worker')
  })

  it('provides clearer fallback names and actual roles for dolly profiles', () => {
    expect(fallbackDisplayName('dolly')).toBe('Dolly Main')
    expect(fallbackDisplayName('dollyops')).toBe('DollyOps')
    expect(fallbackRoleForWorker('dollydesign')).toBe('design')
    expect(fallbackRoleForWorker('dollyprivate')).toBe('private')
  })
})
