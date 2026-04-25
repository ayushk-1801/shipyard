FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY examples/node-hello/package.json examples/node-hello/package.json
RUN npm ci --workspace @shipyard/api --include-workspace-root=false

COPY apps/api apps/api
RUN npm run build -w @shipyard/api

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gzip tar unzip docker.io \
  && rm -rf /var/lib/apt/lists/* \
  && curl -sSL https://railpack.com/install.sh | RAILPACK_VERSION=0.15.1 sh -s -- --bin-dir /usr/local/bin

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY examples/node-hello/package.json examples/node-hello/package.json
RUN npm ci --omit=dev --workspace @shipyard/api --include-workspace-root=false

COPY --from=builder /app/apps/api/dist apps/api/dist

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
