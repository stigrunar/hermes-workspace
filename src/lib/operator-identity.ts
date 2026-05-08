function titleCaseSlug(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const OPERATOR_DISPLAY_NAME_MAP: Record<string, string> = {
  default: 'Workspace',
  dolly: 'Dolly Main',
  dollycode: 'DollyCode',
  dollydesign: 'DollyDesign',
  dollyops: 'DollyOps',
  dollyprivate: 'DollyPrivate',
}

export function fallbackOperatorDisplayName(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (!normalized) return id
  if (OPERATOR_DISPLAY_NAME_MAP[normalized]) {
    return OPERATOR_DISPLAY_NAME_MAP[normalized]
  }
  if (/^swarm\d+$/i.test(id)) {
    return id.replace(/^swarm/i, 'Swarm')
  }
  return titleCaseSlug(id)
}

export function formatOperatorIdentity(
  displayName: string | null | undefined,
  id: string,
): string {
  const label = displayName?.trim() || fallbackOperatorDisplayName(id)
  return `${label} · ${id}`
}

export function formatOperatorRoleBadge(role: string | null | undefined): string {
  const value = role?.trim()
  if (!value) return 'Worker'
  return value
    .replace(/^swarm\d+\s*[·/-]*/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}
