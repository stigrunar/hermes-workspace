import { stat } from 'node:fs/promises'

function defaultImportModule(specifier) {
  return import(specifier)
}

function resolveServerBuildUrl(serverBuildUrl) {
  if (serverBuildUrl instanceof URL) return serverBuildUrl
  if (typeof serverBuildUrl === 'string') {
    return new URL(serverBuildUrl, import.meta.url)
  }
  return new URL('./dist/server/server.js', import.meta.url)
}

export function createServerBuildLoader({
  serverBuildUrl,
  statFn = stat,
  importModule = defaultImportModule,
} = {}) {
  const resolvedServerBuildUrl = resolveServerBuildUrl(serverBuildUrl)
  let cachedKey = null
  let cachedBuildPromise = null

  return async function loadServerBuild() {
    const buildStat = await statFn(resolvedServerBuildUrl)
    const nextKey = `${buildStat.mtimeMs}:${buildStat.size}`

    if (cachedBuildPromise && cachedKey === nextKey) {
      return cachedBuildPromise
    }

    const freshImportUrl = new URL(resolvedServerBuildUrl.href)
    freshImportUrl.searchParams.set('v', nextKey)

    const nextBuildPromise = importModule(freshImportUrl.href).then((module) => {
      const serverBuild = module?.default
      if (!serverBuild || typeof serverBuild.fetch !== 'function') {
        throw new TypeError(
          `Server build at ${resolvedServerBuildUrl.href} did not export a default fetch handler`,
        )
      }
      return serverBuild
    })

    cachedKey = nextKey
    cachedBuildPromise = nextBuildPromise

    try {
      return await nextBuildPromise
    } catch (error) {
      if (cachedBuildPromise === nextBuildPromise) {
        cachedKey = null
        cachedBuildPromise = null
      }
      throw error
    }
  }
}
