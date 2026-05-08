import { describe, expect, it } from 'vitest'
import { getConductorWorkerPersona } from './conductor-worker-personas'

describe('conductor worker personas', () => {
  it('uses neutral mission-worker labels instead of legacy named personas', () => {
    expect(getConductorWorkerPersona(0)).toEqual({
      emoji: '🤖',
      name: 'Worker 1',
    })
    expect(getConductorWorkerPersona(1).name).toBe('Worker 2')
    expect(getConductorWorkerPersona(7).name).toBe('Worker 8')
  })

  it('wraps emoji assignment while keeping monotonically increasing worker labels', () => {
    expect(getConductorWorkerPersona(8)).toEqual({
      emoji: '🤖',
      name: 'Worker 9',
    })
  })
})