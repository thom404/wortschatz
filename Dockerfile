# syntax=docker/dockerfile:1
# Stateless game box: word list ships per ADR-0001 (the dictionary
# module itself lands with #7); no volume, stdout-only logs, PORT env (default 3000).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
RUN npm install --no-audit --no-fund \
 && npm run typecheck \
 && npm test \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S wordament && adduser -S wordament -G wordament
COPY --from=build --chown=wordament:wordament /app /app
ENV PORT=3000 WORDAMENT_STATIC_DIR=/app/packages/client/dist
EXPOSE 3000
USER wordament
CMD ["node", "packages/server/dist/main.js"]
