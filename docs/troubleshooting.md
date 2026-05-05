# Troubleshooting — Hermes Workspace

Common setup issues and how to fix them.

---

## 1. Gateway starts but API server never binds (port 8642 not listening)

**Symptom:** `hermes gateway run` appears to start, but `curl http://127.0.0.1:8642/health` fails.

**Cause:** `API_SERVER_ENABLED` is missing or typoed.

**Fix:**

```bash
HERMES_ENV="$(hermes config env-path 2>/dev/null || echo "$HOME/.hermes/.env")"
grep -i API_SERVER "$HERMES_ENV"
```

The env var must be **exactly** `API_SERVER_ENABLED=true`.
Common mistakes:

- `APISERVERENABLED=true` → wrong
- `APISERVERHOST=0.0.0.0` → wrong key name
- `API_SERVER_HOST=0.0.0.0` without `API_SERVER_KEY` → unsafe and may refuse to bind

After fixing, restart the gateway:

```bash
hermes gateway run
# or
systemctl --user restart hermes-gateway.service
```

---

## 2. Workspace shows "Connect Backend" / "Skip setup" (`mode=disconnected`)

**Symptom:** Browser shows onboarding instead of the normal Workspace UI.

**Cause:** Workspace cannot reach the Hermes gateway HTTP API.

**Checklist:**

1. `hermes gateway status`
2. `curl -sf http://127.0.0.1:8642/health`
3. `grep HERMES_API_URL ~/hermes-workspace/.env`
4. restart Workspace

Expected:

```text
HERMES_API_URL=http://127.0.0.1:8642
```

---

## 3. `hermes` works in shell, but Workspace worker dispatch still fails

**Symptom:** Interactive shell can run `hermes`, but Workspace one-shot dispatches or tmux worker launches fail.

**Cause:** the Workspace service/runtime PATH does not include `~/.local/bin`.

**Fix:** ensure the service PATH includes it.

Example systemd service fragment:

```text
Environment=PATH=/home/<user>/.local/bin:/usr/local/bin:/usr/bin:/bin
```

Then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-workspace.service
```

---

## 4. Kanban view returns 500 / blank board

**Symptom:** `/api/swarm-kanban` errors, Kanban board fails to load, or logs show `spawnSync sqlite3 ENOENT`.

**Cause:** `sqlite3` binary is missing on the host.

**Important:** the database file can exist at `~/.hermes/kanban.db` and still fail if the binary is missing.

**Fix:**

```bash
sqlite3 --version
# if missing:
sudo apt-get update && sudo apt-get install -y sqlite3
```

Re-test:

```bash
curl -sS http://127.0.0.1:3000/api/swarm-kanban
```

---

## 5. Swarm worker card exists but persistent worker does not start

**Symptom:** Runtime card exists, but there is no live tmux-backed worker.

**Most common causes:**

- `tmux` is not installed
- worker profile does not exist under `~/.hermes/profiles/<workerId>/`
- worker wrapper does not exist under `~/.local/bin/<workerId>`
- Workspace runtime PATH cannot see `hermes`

**Checks:**

```bash
tmux -V
ls ~/.hermes/profiles/<workerId>
ls ~/.local/bin/<workerId>
tmux ls
```

Expected tmux session name:

```text
swarm-<workerId>
```

---

## 6. One-shot dispatch works, but tmux-backed Swarm still feels half-alive

**Cause:** Workspace can fall back to one-shot `hermes chat -q ...` delivery even when persistent worker wiring is incomplete.

That means:
- dispatch can appear to work
- reports can appear to work
- runtime card can still exist
- but the "persistent worker" experience is not fully there yet

For the full Swarm lane, you need all of:
- `hermes` on runtime PATH
- `tmux`
- worker profile
- worker wrapper

---

## 7. "Kanban motoren" does not move cards by itself

**Symptom:** The board loads, but nothing autonomously advances without manual dispatch or explicit loop execution.

**Cause:** the board is a planning/control surface, not a guaranteed always-on scheduler.

Verified current truth:
- `/api/swarm-orchestrator-loop` exists
- dispatch/runtime/report plumbing exists
- background self-scheduling is not guaranteed on a fresh install

So if you want true autopilot, wire it deliberately as local ops behavior. Do not assume the board itself is the engine.

---

## 8. WSL / service startup is inconsistent

**Symptom:** Gateway or Workspace behaves differently in terminal vs systemd.

**Common reasons:**

- different PATH
- different `HOME`
- different active profile env
- service sees `~/.hermes/...`, shell sees something else

**Checks:**

```bash
systemctl --user show hermes-workspace.service --property=Environment --no-pager
systemctl --user show hermes-gateway.service --property=Environment --no-pager
hermes config env-path
```

---

## 9. Legacy Claude wording is confusing setup

**Symptom:** Docs/logs mention `claude`, but the install actually uses Hermes Agent.

**Truth:** some Claude-era names remain as compatibility residue in docs, env aliases, route/file names, and log labels.

Use this rule:
- prefer `hermes`
- prefer `HERMES_HOME`
- prefer `~/.hermes`
- treat `claude` wording as legacy unless the doc explicitly says it is compatibility behavior

---

## Diagnostic bundle

```bash
echo "=== hermes version ===" && hermes --version 2>&1
echo "=== hermes env path ===" && hermes config env-path 2>&1
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
