FROM node:22-bookworm-slim AS web-builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY examples/node-hello/package.json examples/node-hello/package.json
RUN npm ci --workspace @brimble/web --include-workspace-root=false

COPY apps/web apps/web
RUN npm run build -w @brimble/web

FROM caddy:2.10-alpine

COPY ops/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-builder /app/apps/web/dist /srv

EXPOSE 80 2019
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
