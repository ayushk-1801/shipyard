# Shipyard

A one-page local PaaS slice for a deployment pipeline take-home: Vite + TanStack UI, Hono API, SQLite state, Railpack image builds, Docker runtime, and Caddy as the only ingress.

## Run

Prerequisites:
- Docker with Compose
- Internet access for the first image/package/Railpack downloads
- Uploaded archives must be `.zip`, `.tar.gz`, or `.tgz`; the default max upload size is `50MB`.
- Optional tuning: `IMAGE_HISTORY_LIMIT` defaults to `5`, `GRACEFUL_STOP_SECONDS` defaults to `10`, and `MAX_UPLOAD_BYTES` defaults to `52428800`.

Start everything:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080
```

The API, frontend, Caddy, BuildKit, SQLite database, Railpack binary, and runtime containers are all driven from that Compose stack. Deployed apps are reachable through Caddy at both:

```text
http://localhost:8080/d/<slug>/
http://<slug>.localhost:8080/
```

The hostname route is the preferred live URL for apps that generate absolute asset paths such as `/assets/app.js`. The path route is useful for quick inspection, but apps that assume they live at `/` may need the hostname route.

## Try The Sample App

Create an archive from the included sample app:

```bash
tar -czf node-hello.tgz -C examples/node-hello .
```

In the UI, choose Upload, select `node-hello.tgz`, keep port `3000`, and deploy. Logs should stream through `pending -> building -> deploying -> running`.

For Git deployments, HTTPS URLs like `https://github.com/org/repo.git` and SSH-style URLs like `git@github.com:org/repo.git` are accepted. Private repositories require whatever credentials are already available to the backend container.

Once a deployment is running, use the row actions to redeploy the current source or cancel queued/active work. Select a deployment to see its image history; previous tags can be rolled back without rebuilding. Log search and retention controls sit above the live SSE log stream.

## Architecture

- `apps/web`: Vite React app using TanStack Router, TanStack Query, Tailwind CSS, and shadcn-style local components.
- `apps/api`: Hono API with SQLite persistence, SSE streams, a single-worker deployment queue, and services for Railpack, BuildKit, Docker, and Caddy.
- `ops/caddy`: Caddy image that builds/serves the frontend and exposes only port `8080` on the host.
- `examples/node-hello`: Dockerfile-free sample app for Railpack.

The backend talks to the Compose-managed BuildKit service through `BUILDKIT_HOST` for Railpack builds, and mounts `/var/run/docker.sock` to load/start deployment containers on the shared `shipyard-runtime` network. It periodically reconciles SQLite `running` deployments against Docker so stale containers are marked failed and removed from Caddy routes. That is intentionally simple for this local assignment and intentionally not a production security model for untrusted multi-tenant code.

Redeploy and rollback are handled as replacement operations for the same slug. The backend starts the candidate container first, waits for an HTTP response, reloads Caddy with the new target, then gracefully stops the previous container. During an active replacement the previous running route stays in the generated Caddyfile, so a failed health check or failed Caddy reload does not strand the app.

## API

- `GET /api/health`
- `GET /api/deployments`
- `GET /api/deployments/:id`
- `POST /api/deployments` with `multipart/form-data`
- `GET /api/deployments/:id/images`
- `POST /api/deployments/:id/redeploy`
- `POST /api/deployments/:id/rollback` with `{ "imageId": "..." }`
- `POST /api/deployments/:id/cancel`
- `GET /api/deployments/:id/logs` as SSE
- `GET /api/deployments/:id/logs/search?query=&phase=&stream=&limit=`
- `POST /api/deployments/:id/logs/retention` with `keepLast` and/or `olderThanDays`
- `GET /api/deployments/events` as SSE

Logs are written to SQLite as they stream, so reconnecting or selecting an older deployment replays the history before following live events.

## Decisions

- TypeScript end-to-end keeps API and UI contracts easy to inspect.
- Hono is small enough for the assignment but still gives clean routing and Web-standard request/response primitives.
- SQLite is enough for local durability, replayable logs, and restart recovery.
- Caddy is reloaded through its admin API with a full generated Caddyfile. A failed reload keeps the previous config in place.
- Railpack builds user apps with no user Dockerfile. The platform service images do use Dockerfiles because Compose needs to build the API and Caddy/frontend containers.
- Successful image tags are kept per deployment slug so rollback is local and fast. Older inactive history is pruned best-effort with Docker image cleanup.
- Cancellation uses in-memory operation controllers. That is enough for this local single-process API, while restart recovery still marks interrupted active work failed.

## Cleanup

Stop the platform:

```bash
docker compose down
```

Remove deployment containers created by the app:

```bash
docker ps -aq --filter label=shipyard.assignment=true | xargs -r docker rm -f
```

Remove local images from sample deploys:

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^shipyard-' | xargs -r docker rmi
```

## Tests

```bash
npm install
npm test
npm run typecheck
npm run build
```

## What I Would Do With Another Weekend

- Replace Docker socket access with a constrained build/runtime worker boundary.
- Persist operation records separately from app/deployment rows so cancellation history can be represented without overloading the app status.
- Add zero-downtime readiness gates with per-app health check paths instead of the current basic HTTP probe.
- Move image retention into a background garbage collector with clearer disk usage reporting.

## Time Spent

Roughly 6-7 hours.

## Walkthrough

Loom: https://www.loom.com/share/f6e9c35468a940dba86e4132cefe8fed

## Brimble Feedback

I deployed a small React boilerplate app on Brimble:

```text
https://my-react-app.brimble.app/
```

The feedback write-up is in `docs/brimble-feedback.md`.
