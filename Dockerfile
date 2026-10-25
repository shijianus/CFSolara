# Sonic Local Engine — Multi-stage Node 22 Alpine Container
FROM node:22-alpine AS builder
WORKDIR /app

# Install esbuild for zero-dependency single-file server bundling
RUN npm install --no-save esbuild@0.25.4

COPY functions ./functions
COPY server ./server
COPY tsconfig.json* package.json ./

RUN ./node_modules/.bin/esbuild server/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist-server/index.mjs \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV SONIC_RUNTIME=linux-engine
ENV PORT=8080
ENV HOST=0.0.0.0
ENV SONIC_RECOMMEND_DB_PATH=/app/data/sonic-recommend.sqlite

COPY --from=builder /app/dist-server ./dist-server
COPY dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --header="X-Sonic-Engine-Key: ${SONIC_ENGINE_SECRET}" http://127.0.0.1:8080/api/sonic/engine/health >/dev/null || exit 1

USER node
CMD ["node", "dist-server/index.mjs"]
