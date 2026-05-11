import { describe, expect, it } from 'vitest'
import { fallbackDisplayName, fallbackRoleForWorker } from './swarm-roster'
import {
  formatSwarmIdentity,
  formatSwarmRoleBadge,
} from '../components/swarm/swarm-identity'

describe('swarm identity helpers', () => {
  it('formats display names with ids for swarm roster cards', () => {
    expect(formatSwarmIdentity('Control Mirror', 'swarm3')).toBe('Control Mirror · swarm3')
    expect(formatSwarmIdentity('', 'swarm8')).toBe('Swarm8 · swarm8')
  })

  it('uses concise role badges from canonical roles', () => {
    expect(formatSwarmRoleBadge('Swarm Control Plane Main-Session Mirror')).toBe(
      'Swarm Control Plane Main Session Mirror',
    )
    expect(formatSwarmRoleBadge('')).toBe('Worker')
  })

  it('provides clearer fallback names and actual roles for dolly profiles', () => {
    expect(fallbackDisplayName('default')).toBe('Dolly Main')
    expect(fallbackDisplayName('dolly')).toBe('Dolly Legacy')
    expect(fallbackDisplayName('dollyops')).toBe('DollyOps')
    expect(fallbackDisplayName('dollyqa')).toBe('DollyQA')
    expect(fallbackDisplayName('dollyresearch')).toBe('DollyResearch')
    expect(fallbackRoleForWorker('default')).toBe('controller')
    expect(fallbackRoleForWorker('dolly')).toBe('legacy/stopped')
    expect(fallbackRoleForWorker('dollydesign')).toBe('design')
    expect(fallbackRoleForWorker('dollyprivate')).toBe('private')
  })
})
