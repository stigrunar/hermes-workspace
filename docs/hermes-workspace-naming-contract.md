# Hermes Workspace Naming Contract

This repo is for **Hermes Workspace** and **Hermes Agent** work.

## Canonical product names

Use these names in all new UI, docs, skills, prompts, tests, review comments, and handoffs:

- **Hermes Workspace**
- **Hermes Agent**
- **Swarm**
- **Hermes Kanban**
- **HERMES_HOME**
- `~/.hermes`
- `hermes` (CLI)

## Legacy compatibility rule

Older code and docs still contain Claude-era wording.
Treat that as compatibility residue, not as the preferred naming.

Default action:
- normalize new work to Hermes naming
- preserve Claude wording only when documenting legacy behavior, migrations, env aliases, or old log strings
- do not introduce fresh Claude branding into new user-facing text unless it is explicitly labeled legacy

## Allowed legacy references

These may still appear when describing compatibility behavior:

- `CLAUDE_HOME` as a legacy env alias
- `CLAUDE_*` env vars that are still accepted by runtime code
- `[claude-api]` or similar existing log labels
- `claude` as a historical CLI alias if a host still ships it

When you mention them, make the Hermes-first meaning explicit.

## Runtime/path rules

For live runtime guidance, prefer:

- `HERMES_HOME`
- `~/.hermes/profiles/<workerId>`
- `hermes`
- Hermes worker sessions
- Hermes/OpenAI Codex or other provider labels as configured in profile `config.yaml`

Avoid suggesting Claude-specific profile paths or Claude-branded setup as the primary path for Hermes Workspace.

## Swarm/UI language rules

Prefer:
- **Ready** instead of person-specific lane labels
- **Board / Cards / List** for planning surfaces
- **Hermes Workspace** and **Hermes Agent** in update/config/status UI
- **OpenAI Codex** when the provider/model is actually Codex-backed

Avoid:
- person-specific product labels baked into UI
- new Claude-branded wording in Hermes Workspace surfaces
- claiming Claude is required when Hermes runtime is what actually executes the work

## Reviewer rule

Any PR or patch that introduces new Claude-branded naming into Hermes Workspace should be treated as a regression unless it is:
- a legacy compatibility note
- a migration guide
- a quoted historical artifact
- a code-level alias required to keep old installs working

## Agent instruction rule

When an agent is working in this repo:
- assume Hermes naming is canonical
- rewrite Claude-era references to Hermes by default
- keep legacy aliases only where they explain compatibility behavior truthfully
- prefer repo-native Hermes terminology over historical aliases when uncertain
