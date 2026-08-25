# TradingJournal Deployment Boundary

**Reader:** a homelab operator or future maintainer deploying TradingJournal.
**Post-read action:** deploy the single container on the private LAN/VPN,
confirm the boundary holds, and know exactly what the health endpoint and
backup/restore surfaces expose.

TradingJournal is a **local-first trading journal**. It is a private
operational tool for the owner's personal trading data — trades, executions,
risk snapshots, and accounting. It must remain **private LAN/VPN-only with no
public ingress**. This document records the deployment topology, the image
boundary, the runtime configuration, the health contract, and the backup /
restore entry points, and how each is statically verified.

---

## 1. Deployment topology

```
                        ┌──────────────────────────────────────┐
   Operator (VPN)  ───▶ │  Private LAN / VPN subnet            │
                        │                                      │
                        │   ┌──────────────────────────────┐   │
   Homelab host  ──────▶│   │  Single Docker container     │   │
   (docker run / podman)│   │  node:22-alpine              │   │
                        │   │  next start (Next.js)        │   │
                        │   │  port 3000 (container-internal)│  │
                        │   └──────────────┬───────────────┘   │
                        │                  │ volume            │
                        │            ┌─────▼─────┐             │
                        │            │ /data     │  SQLite DB  │
                        │            │ journal.db│  + uploads  │
                        │            └───────────┘             │
                        └──────────────────────────────────────┘
```

- **Single Docker container** on the private LAN. No public DNS record exists
  for the service. No port forwarding rule on the homelab router maps into it.
  No reverse proxy or ingress controller fronts it toward the internet.
- The service is reachable only from the LAN or from the VPN when the operator
  connects to the private network.
- The database lives on a **Docker volume** mounted at `/data`, so the data
  survives container replacement and is not baked into the image.
- All interaction happens over HTTP on the container-internal port 3000;
  the operator reaches it at `http://<lan-or-vpn-ip>:3000`.

## 2. Image build (Dockerfile)

The image is built in **three stages**, all from `node:22-alpine` (the same
Node major used in CI), so the runtime and the build toolchain stay
consistent:

| Stage | Purpose | Key facts |
|---|---|---|
| `deps` | Install the full dependency tree | `apk add python3 make g++` for the `better-sqlite3` native addon; `npm ci` for **deterministic** dependency resolution from the committed lockfile |
| `builder` | Compile the Next.js application | Reuses `deps` node_modules; copies source; pre-creates the build database with all migrations marked applied (`prepopulate-migrations.cjs`) so `next build` — which eagerly imports the DB layer — cannot race on migration writes; runs `next build` |
| `runner` | Minimal production image | Copies only the built `.next`, `public`, migrations, and schema; `npm prune --omit=dev` drops dev dependencies; test/type tooling (`vitest`, `eslint`, `typescript`, `playwright`) is explicitly removed |

**Non-root runtime.** The runner creates a dedicated `nextjs` system user
(UID 1001) and switches to it with `USER nextjs` before the server starts.
The `/data` directory and the uploads directory are chowned to that user so
the process can write the database and upload assets without root privileges.

**Health check.** The image declares a `HEALTHCHECK` that runs
`curl -fs http://localhost:3000/api/health` every 30 seconds (10s timeout,
15s start period, 3 retries). A failing health probe marks the container
unhealthy, which Docker surfaces and orchestration can act on.

**Port exposure.** `EXPOSE 3000` is documentation-only in Docker — it never
publishes a port to a host interface. There is no `-p`/`--publish` in the
default run path and no compose file in the repository that maps ports to the
host. The single exposed port is the container-internal application port.

## 3. Runtime configuration

| Variable | Value | Meaning |
|---|---|---|
| `NODE_ENV` | `production` | Production Next.js server |
| `PORT` | `3000` | Container-internal HTTP port |
| `HOSTNAME` | `0.0.0.0` | Bind **inside the container** so the server answers on the container network; this is not a host or public binding |
| `DB_FILE_NAME` | `/data/journal.db` | SQLite database on the volume mount, not baked into the image |
| Uploads | `public/uploads/trades` | Uploaded trade/screenshot assets, writable by the non-root user |

The application binds to the `HOSTNAME` environment variable; no source file
hardcodes a `0.0.0.0` binding. The container-internal `0.0.0.0` value is set
in the image and never escapes the container network namespace.

## 4. Health endpoint contract

`GET /api/health` is the single liveness/readiness probe used by the Docker
`HEALTHCHECK` and by homelab monitoring.

- **Healthy:** `200` with
  `{ "status": "ok", "db": "connected", "timestamp": "<ISO-8601>" }` —
  returned after a real `SELECT 1` against the SQLite database.
- **Degraded:** `503` with
  `{ "status": "error", "db": "disconnected", "message": "<reason>", "timestamp": "<ISO-8601>" }`
  when the database query throws.

Because it performs a real database round-trip, a green health probe
guarantees both the HTTP server and the SQLite layer are responding.

## 5. Backup / restore entry points

All backup and restore operations are server-side endpoints that run the
canonical backup pipeline (`createBackupBuffer` → ZIP with a versioned
`manifest.json` and per-table JSON data files). They are **not** publicly
reachable — they live on the same private-LAN surface as the rest of the app.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/backup/now` | POST | Trigger an on-demand backup job (create archive, write to the backup directory, record status, run retention cleanup) |
| `/api/backup` | GET | Download a full backup ZIP (versioned manifest + per-table JSON + upload assets) |
| `/api/backup/status` | GET | Report backup job status |
| `/api/backup/files` | GET | List stored backup files |
| `/api/backup/restore/[filename]` | POST | Restore from a stored backup file |
| `/api/backup/import-local` | POST | Import a backup already on the host |
| `/api/restore` | POST | Validate and execute a full restore from an uploaded ZIP (multipart `backup` field) |
| `/api/restore/preview` | GET | Preview what a restore would replace |

These routes use the canonical pipeline modules (`backup-job`,
`create-backup`, `restore`). The retired cash-activity surface
(`account_transactions`-based endpoints) is **not** referenced by any of
them — stale callers of the retired `POST /api/accounts/:id/transactions`
receive a `410 Gone` directing them to the canonical
`POST /api/accounts/:id/financial-events` path.

## 6. Network isolation confirmation

Confirmed as of the deployment-boundary check (see §7):

- **No public DNS records** exist for the service.
- **No port forwarding rules** on the homelab router map into the container.
- **No reverse proxy / ingress controller** (nginx, Traefik, Caddy, HAProxy,
  or a cloud ingress) fronts the service toward the internet.
- **No `0.0.0.0` binding in source code.** The only occurrence is the
  Dockerfile `ENV HOSTNAME="0.0.0.0"`, which binds inside the container
  network namespace.
- **No compose file** in the repository maps a service port to the host. If a
  compose file is ever added, it must not contain a `ports:` mapping.
- Access is possible only via LAN IPs or the VPN when the operator is
  connected.

## 7. Static verification

The boundary is enforced mechanically, not by convention. Run:

```bash
node scripts/verify-deployment-boundary.mjs
```

The script checks, and fails on any violation of:

1. Dockerfile runs as non-root (`USER nextjs`).
2. Dockerfile uses `npm ci` (deterministic deps).
3. Dockerfile declares a `HEALTHCHECK` against `/api/health`.
4. Dockerfile sets `DB_FILE_NAME=/data/journal.db` (volume-mounted DB).
5. Dockerfile `EXPOSE`s only the container-internal port 3000.
6. Health endpoint exists at `src/app/api/health/route.ts`.
7. Health endpoint returns JSON with a `status` field.
8. No source file hardcodes a `0.0.0.0` binding.
9. Backup/restore routes exist and never reference the retired
   `account_transactions` path.
10. Any compose file present publishes no host ports.

Exit 0 means the boundary holds; exit 1 means a boundary regression was
introduced and must be fixed before deploy.

## 8. Deploying on the LAN/VPN

```bash
# Build the image
docker build -t trading-journal:latest .

# Run on the private LAN host, data on a named volume
docker run -d \
  --name trading-journal \
  -v trading-journal-data:/data \
  -p 127.0.0.1:3000:3000 \
  trading-journal:latest

# Verify health
curl -fs http://127.0.0.1:3000/api/health
```

Notes:

- The `-p` example binds to the loopback of the LAN host. To expose on the
  LAN/VPN subnet, bind explicitly to the private interface — never to
  `0.0.0.0` on a host with a public interface.
- Backups created via `/api/backup/now` and downloaded via `/api/backup`
  should be copied to independent storage (off-host) for real recovery
  capability. The recovery drill
  (`npx tsx scripts/recovery-drill.ts`, part of `make test-all`) proves the
  backup → independent storage → restore → verify round-trip end to end.
- Monitor the container with the Docker health status and the `/api/health`
  JSON contract above.
