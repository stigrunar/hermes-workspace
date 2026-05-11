import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { formatOperatorIdentity } from '../lib/operator-identity'
import { readSwarmRoster } from './swarm-roster'

export type RawAssignee = {
  id?: unknown
  name?: unknown
  label?: unknown
  isHuman?: unknown
  is_human?: unknown
}

export type KanbanAssignee = {
  id: string
  label: string
  isHuman: boolean
  dispatchSupported: boolean
  dispatchReason: string | null
}

export type AssigneeTaskScopeInput = {
  title?: string | null
  body?: string | null
}

const HERMES_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(HERMES_HOME, 'config.yaml')
const PROFILES_PATH = path.join(HERMES_HOME, 'profiles')
const NUMERIC_SWARM_ID_PATTERN = /^swarm\d+$/i
const DURABLE_OWNER_REQUIRED_PATTERNS = [
  /\bproject_brief\.md\b/i,
  /\btasks\.md\b/i,
  /\bnext phase\b/i,
  /\bdesign contract\b/i,
  /\bgovernance\b/i,
  /\bdecision\b/i,
  /\bknowledge(?:\s|-)?vault\b/i,
  /\bsynthesi[sz]e\b[\s\S]{0,80}\broute\b/i,
]

function readYamlFile(targetPath: string): Record<string, unknown> {
  try {
    return (YAML.parse(fs.readFileSync(targetPath, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

export function readHermesConfig(): Record<string, unknown> {
  return readYamlFile(CONFIG_PATH)
}

export function getProfileNames(): string[] {
  try {
    return fs.readdirSync(PROFILES_PATH).filter((name) => {
      try {
        const profilePath = path.join(PROFILES_PATH, name)
        return fs.statSync(profilePath).isDirectory() && fs.existsSync(path.join(profilePath, 'config.yaml'))
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function readProfileConfig(workerId: string): Record<string, unknown> | null {
  const configPath = path.join(PROFILES_PATH, workerId, 'config.yaml')
  if (!fs.existsSync(configPath)) return null
  return readYamlFile(configPath)
}

function readModelName(config: Record<string, unknown> | null): string | null {
  if (!config) return null
  const model = config.model
  if (typeof model === 'string') {
    const trimmed = model.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (model && typeof model === 'object') {
    const record = model as Record<string, unknown>
    const direct = typeof record.model === 'string' ? record.model.trim() : ''
    if (direct) return direct
    const fallback = typeof record.default === 'string' ? record.default.trim() : ''
    if (fallback) return fallback
  }
  return null
}

function rosterDisplayName(workerId: string): string | null {
  if (!NUMERIC_SWARM_ID_PATTERN.test(workerId)) return null
  const rosterWorker = readSwarmRoster([workerId]).workers.find((worker) => worker.id === workerId)
  const name = rosterWorker?.name?.trim()
  return name ? name : null
}

function formatAssigneeLabel(workerId: string, rawLabel?: unknown): string {
  const rosterName = rosterDisplayName(workerId)
  if (rosterName) return formatOperatorIdentity(rosterName, workerId)
  if (typeof rawLabel === 'string') {
    const trimmed = rawLabel.trim()
    if (trimmed.length > 0) {
      if (trimmed.endsWith(`· ${workerId}`)) return trimmed
      if (trimmed.toLowerCase() !== workerId.toLowerCase()) return formatOperatorIdentity(trimmed, workerId)
    }
  }
  return formatOperatorIdentity(null, workerId)
}

function taskNeedsDurableOwner(input: AssigneeTaskScopeInput | null | undefined): boolean {
  const text = `${input?.title ?? ''}\n${input?.body ?? ''}`.trim()
  if (!text) return false
  return DURABLE_OWNER_REQUIRED_PATTERNS.some((pattern) => pattern.test(text))
}

export function getAssigneeDispatchSupport(workerId: string, humanReviewer: string | null = null): {
  dispatchSupported: boolean
  dispatchReason: string | null
} {
  if (humanReviewer && workerId === humanReviewer) {
    return {
      dispatchSupported: false,
      dispatchReason: 'Human reviewer is not a Kanban worker profile.',
    }
  }
  const profileConfig = readProfileConfig(workerId)
  if (!profileConfig) {
    return {
      dispatchSupported: false,
      dispatchReason: `No Hermes profile config found for assignee "${workerId}".`,
    }
  }
  const modelName = readModelName(profileConfig)
  if (!modelName) {
    return {
      dispatchSupported: false,
      dispatchReason: `Profile "${workerId}" has no configured model, so Matrix cannot dispatch it as a Kanban worker.`,
    }
  }
  return {
    dispatchSupported: true,
    dispatchReason: null,
  }
}

export function getAssigneeTaskScopeSupport(workerId: string, input?: AssigneeTaskScopeInput | null): {
  allowed: boolean
  reason: string | null
} {
  if (!NUMERIC_SWARM_ID_PATTERN.test(workerId) || !taskNeedsDurableOwner(input)) {
    return { allowed: true, reason: null }
  }
  return {
    allowed: false,
    reason: `Assignee "${workerId}" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.`,
  }
}

export function normalizeAssigneePayload(payload: unknown, humanReviewer: string | null): Array<KanbanAssignee> {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  const rawAssignees = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.assignees)
      ? record.assignees
      : []

  const seen = new Set<string>()
  const assignees: Array<KanbanAssignee> = []

  for (const raw of rawAssignees) {
    const item = typeof raw === 'string' ? { id: raw, label: raw } : raw as RawAssignee
    const id = typeof item.id === 'string'
      ? item.id
      : typeof item.name === 'string'
        ? item.name
        : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = formatAssigneeLabel(id, item.label)
    const support = getAssigneeDispatchSupport(id, humanReviewer)
    assignees.push({
      id,
      label,
      isHuman: item.isHuman === true || item.is_human === true || id === humanReviewer,
      dispatchSupported: support.dispatchSupported,
      dispatchReason: support.dispatchReason,
    })
  }

  return assignees
}

export function listKnownKanbanAssignees(input?: {
  remotePayload?: unknown
  humanReviewer?: string | null
}): Array<KanbanAssignee> {
  const humanReviewer = input?.humanReviewer ?? null
  const merged = new Map<string, KanbanAssignee>()

  for (const assignee of normalizeAssigneePayload(input?.remotePayload, humanReviewer)) {
    merged.set(assignee.id, assignee)
  }

  for (const id of getProfileNames()) {
    if (merged.has(id)) continue
    const support = getAssigneeDispatchSupport(id, humanReviewer)
    merged.set(id, {
      id,
      label: formatAssigneeLabel(id),
      isHuman: id === humanReviewer,
      dispatchSupported: support.dispatchSupported,
      dispatchReason: support.dispatchReason,
    })
  }

  if (humanReviewer && !merged.has(humanReviewer)) {
    const support = getAssigneeDispatchSupport(humanReviewer, humanReviewer)
    merged.set(humanReviewer, {
      id: humanReviewer,
      label: formatAssigneeLabel(humanReviewer),
      isHuman: true,
      dispatchSupported: support.dispatchSupported,
      dispatchReason: support.dispatchReason,
    })
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.dispatchSupported !== b.dispatchSupported) return a.dispatchSupported ? -1 : 1
    if (a.isHuman !== b.isHuman) return a.isHuman ? 1 : -1
    return a.label.localeCompare(b.label)
  })
}
