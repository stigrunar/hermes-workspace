import { describe, expect, it, vi } from 'vitest'

import { createServerBuildLoader } from '../../server-build-loader.js'

describe('createServerBuildLoader', () => {
  it('reuses the loaded server build until the build file changes', async () => {
    let version = 1
    const imports: Array<string> = []

    const loadServerBuild = createServerBuildLoader({
      serverBuildUrl: 'file:///tmp/dist/server/server.js',
      statFn: vi.fn(async () => ({
        mtimeMs: version,
        size: version * 10,
      })),
      importModule: vi.fn(async (specifier: string) => {
        imports.push(specifier)
        return {
          default: {
            fetch: vi.fn(async () => new Response(`version-${version}`)),
          },
        }
      }),
    })

    const firstBuild = await loadServerBuild()
    const secondBuild = await loadServerBuild()
    expect(firstBuild).toBe(secondBuild)
    expect(imports).toHaveLength(1)
    expect(imports[0]).toContain('v=1%3A10')

    version = 2

    const thirdBuild = await loadServerBuild()
    expect(thirdBuild).not.toBe(firstBuild)
    expect(imports).toHaveLength(2)
    expect(imports[1]).toContain('v=2%3A20')
  })

  it('clears the cache when a reload fails so the next attempt can retry', async () => {
    let shouldFail = true
    const importModule = vi.fn(async () => {
      if (shouldFail) {
        throw new Error('boom')
      }
      return {
        default: {
          fetch: vi.fn(async () => new Response('ok')),
        },
      }
    })

    const loadServerBuild = createServerBuildLoader({
      serverBuildUrl: 'file:///tmp/dist/server/server.js',
      statFn: vi.fn(async () => ({ mtimeMs: 5, size: 50 })),
      importModule,
    })

    await expect(loadServerBuild()).rejects.toThrow('boom')

    shouldFail = false
    const build = await loadServerBuild()
    expect(typeof build.fetch).toBe('function')
    expect(importModule).toHaveBeenCalledTimes(2)
  })
})
