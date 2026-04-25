# Brimble Deployment Pipeline

A one-page local PaaS slice for the Brimble take-home: Vite + TanStack UI, Hono API, SQLite state, Railpack image builds, Docker runtime, and Caddy as the only ingress.

## Run

Prerequisites:
- Docker with Compose
- Internet access for the first image/package/Railpack downloads

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

## Try The Sample App

Create an archive from the included sample app:

```bash
tar -czf node-hello.tgz -C examples/node-hello .
```

In the UI, choose Upload, select `node-hello.tgz`, keep port `3000`, and deploy. Logs should stream through `pending -> building -> deploying -> running`.

## Architecture

- `apps/web`: Vite React app using TanStack Router, TanStack Query, Tailwind CSS, and shadcn-style local components.
- `apps/api`: Hono API with SQLite persistence, SSE streams, a single-worker deployment queue, and services for Railpack, BuildKit, Docker, and Caddy.
- `ops/caddy`: Caddy image that builds/serves the frontend and exposes only port `8080` on the host.
- `examples/node-hello`: Dockerfile-free sample app for Railpack.

The backend talks to the Compose-managed BuildKit service through `BUILDKIT_HOST` for Railpack builds, and mounts `/var/run/docker.sock` to load/start deployment containers on the shared `brimble-runtime` network. That is intentionally simple for this local assignment and intentionally not a production security model for untrusted multi-tenant code.

## API

- `GET /api/health`
- `GET /api/deployments`
- `GET /api/deployments/:id`
- `POST /api/deployments` with `multipart/form-data`
- `GET /api/deployments/:id/logs` as SSE
- `GET /api/deployments/events` as SSE

Logs are written to SQLite as they stream, so reconnecting or selecting an older deployment replays the history before following live events.

## Decisions

- TypeScript end-to-end keeps API and UI contracts easy to inspect.
- Hono is small enough for the assignment but still gives clean routing and Web-standard request/response primitives.
- SQLite is enough for local durability, replayable logs, and restart recovery.
- Caddy is reloaded through its admin API with a full generated Caddyfile. A failed reload keeps the previous config in place.
- Railpack builds user apps with no user Dockerfile. The platform service images do use Dockerfiles because Compose needs to build the API and Caddy/frontend containers.

## Cleanup

Stop the platform:

```bash
docker compose down
```

Remove deployment containers created by the app:

```bash
docker ps -aq --filter label=brimble.assignment=true | xargs -r docker rm -f
```

Remove local images from sample deploys:

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^brimble-' | xargs -r docker rmi
```

## Tests

```bash
npm install
npm test
npm run typecheck
npm run build
```

## What I Would Do With Another Weekend

- Add redeploy and rollback to previous image tags.
- Keep a small image history per slug and make Caddy route changes atomic per deployment.
- Add build cancellation and graceful container shutdown.
- Replace Docker socket access with a constrained build/runtime worker boundary.
- Add structured log search and retention controls.

## Brimble Feedback

The Brimble deploy feedback belongs in `docs/brimble-feedback.md` after deploying a small app on Brimble. That link/write-up is still required for the final submission.
