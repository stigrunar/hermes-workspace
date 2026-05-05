# Agent Pairing Guide — Workspace ↔ Hermes Gateway

> **Audience:** AI agents and operators setting up Hermes Workspace.
> Run these steps in order. Each step has a verification command.

## Architecture (30-second version)

```text
┌─────────────────┐       HTTP :8642        ┌──────────────────┐
│ Hermes Gateway  │◄──────────────────────►│ Hermes Workspace │
│ (Python, FastAPI)│ /health, /v1/chat,    │ (Node, Vite)     │
│ hermes gateway   │ /api/sessions, etc.   │ port 3000        │
│ run              │                       │                  │
└─────────────────┘                        └──────────────────┘
```

Workspace talks to the gateway over HTTP.
If `curl http://127.0.0.1:8642/health` returns JSON, they can pair.

## Compatibility note

This repo still contains some Claude-era names in code, env aliases, and log labels.
For setup, treat **`hermes` as canonical**.
If a host also has a `claude` binary, that is a legacy alias, not the preferred instruction path.

---

## Step 1 — Is Hermes Agent installed and on PATH?

```bash
hermes --version
```

**Pass:** prints `Hermes Agent vX.Y.Z`.
**Fail:** `command not found`.

### Fix

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
hermes --version
```

### Important for systemd/WSL installs

If Workspace is started by systemd or another supervisor, make sure that runtime PATH also includes `~/.local/bin`.
Otherwise worker dispatches may fail even though `hermes` works in your interactive shell.

Recommended service PATH fragment:

```text
PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
```

---

## Step 2 — Is the API server enabled?

The gateway exposes an HTTP API on port 8642 only when `API_SERVER_ENABLED=true`
is set in the Hermes env file.

```bash
HERMES_ENV="$(hermes config env-path 2>/dev/null || echo "$HOME/.hermes/.env")"
echo "Hermes env file: $HERMES_ENV"
grep -i "API_SERVER" "$HERMES_ENV" 2>/dev/null || echo "NO API_SERVER KEYS FOUND"
```

**Pass:** output includes `API_SERVER_ENABLED=true`.

### Common failure — wrong env var names

```text
# ❌ wrong
APISERVERENABLED=true
APISERVERHOST=0.0.0.0

# ✅ correct
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
```

### Fix

```bash
HERMES_ENV="$(hermes config env-path 2>/dev/null || echo "$HOME/.hermes/.env")"
mkdir -p "$(dirname "$HERMES_ENV")"

sed -i.bak '/^APISERVERENABLED/d; /^APISERVERHOST/d; /^APISERVERKEY/d; /^APISERVERPORT/d' "$HERMES_ENV" 2>/dev/null || true

grep -q '^API_SERVER_ENABLED=' "$HERMES_ENV" 2>/dev/null && \
  sed -i.bak 's/^API_SERVER_ENABLED=.*/API_SERVER_ENABLED=true/' "$HERMES_ENV" || \
  echo 'API_SERVER_ENABLED=true' >> "$HERMES_ENV"
```

**Do not set `API_SERVER_HOST=0.0.0.0`** unless the user explicitly wants network exposure and also sets `API_SERVER_KEY=<secret>`.

---

## Step 3 — Is the gateway process running?

```bash
hermes gateway status
```

**Pass:** shows the gateway as running.

### Fix

```bash
# Foreground/manual
hermes gateway run

# If the gateway was installed as a user service
systemctl --user restart hermes-gateway.service
```

---

## Step 4 — Is port 8642 bound and healthy?

```bash
ss -tlnp | grep 8642 || echo "PORT NOT BOUND"
curl -sf http://127.0.0.1:8642/health && echo "OK" || echo "NOT REACHABLE"
```

**Pass:** port is bound and `/health` returns JSON.

**Fail — gateway running but port not bound:** go back to Step 2.

**Fail — port bound by something else:** identify the other process, stop it, then restart the gateway.

---

## Step 5 — Is Workspace pointed at the gateway?

```bash
grep HERMES_API_URL ~/hermes-workspace/.env
```

**Pass:** `HERMES_API_URL=http://127.0.0.1:8642`

### Fix

```bash
grep -q '^HERMES_API_URL=' ~/hermes-workspace/.env 2>/dev/null && \
  sed -i.bak 's|^HERMES_API_URL=.*|HERMES_API_URL=http://127.0.0.1:8642|' ~/hermes-workspace/.env || \
  echo 'HERMES_API_URL=http://127.0.0.1:8642' >> ~/hermes-workspace/.env
```

If the gateway uses `API_SERVER_KEY`, set the same value in Workspace as `HERMES_API_TOKEN`.

---

## Step 6 — Swarm/Kanban host prerequisites

These are **not optional** if you expect the full Workspace flow to work.

### Persistent Swarm workers need `tmux`

```bash
tmux -V
```

Without tmux, Workspace can still render, but persistent worker sessions and attachable runtime lanes will not behave as designed.

### Hermes Kanban needs `sqlite3`

```bash
sqlite3 --version
```

Workspace reads the canonical board from `~/.hermes/kanban.db` via the local `sqlite3` binary.
If `sqlite3` is missing, `/api/swarm-kanban` can return 500 even when the database file exists.

---

## Step 7 — Start Workspace and verify pairing

```bash
cd ~/hermes-workspace
pnpm dev
```

Look for lines like:

```text
[claude-api] Configured API: http://127.0.0.1:8642
[gateway] gateway=http://127.0.0.1:8642 ...
```

The log label may still say `[claude-api]` on some builds. Treat that as a legacy label.

---

## Step 8 — Verify in browser

Open `http://localhost:3000`.

- **Full UI with chat** = Workspace paired successfully.
- **Connect Backend / Skip setup** = gateway not reachable from Workspace.
- **Kanban 500** = usually missing `sqlite3`.
- **Swarm runtime exists but workers will not start** = usually missing `tmux`, missing PATH to `hermes`, or missing worker wrapper/profile setup.

---

## Important truth about Swarm autopilot

Swarm has orchestrator APIs and runtime state, but **the loop is not inherently self-scheduling on every install**.

What is true today:
- dispatch works
- runtime/report surfaces work
- persistent workers can work when tmux + profiles + wrappers are present
- `/api/swarm-orchestrator-loop` exists

What is **not** guaranteed by default:
- a background scheduler that keeps calling the orchestrator loop forever
- automatic wrapper creation for every worker
- a fully autonomous Kanban-to-dispatch engine with zero local setup

If you want a real autopilot lane, add that consciously as local ops wiring rather than assuming the board drives itself.

---

## Diagnostic bundle

```bash
echo "=== hermes version ===" && hermes --version 2>&1
echo "=== hermes env path ===" && hermes config env-path 2>&1
echo "=== API server env ===" && grep -E '^(API_SERVER|HERMES_)' "$(hermes config env-path 2>/dev/null || echo ~/.hermes/.env)" 2>&1
echo "=== gateway status ===" && hermes gateway status 2>&1
echo "=== port 8642 ===" && (ss -tlnp 2>/dev/null || lsof -iTCP:8642 -sTCP:LISTEN 2>/dev/null) | grep 8642 || echo "not bound"
echo "=== health check ===" && curl -sf http://127.0.0.1:8642/health 2>&1 || echo "not reachable"
echo "=== workspace .env ===" && grep HERMES_API_URL ~/hermes-workspace/.env 2>&1 || echo "no .env"
echo "=== tmux ===" && tmux -V 2>&1
echo "=== sqlite3 ===" && sqlite3 --version 2>&1
echo "=== OS ===" && uname -a
echo "=== Node ===" && node --version
echo "=== Python ===" && python3 --version 2>&1
```
