# syntax=docker/dockerfile:1
# Stateless game box: word list shipped and checksum-verified per ADR-0001;
# dictionary artifact built once here (never committed); no volume, stdout-only
# logs, PORT env (default 3000).
FROM node:22-alpine AS build
WORKDIR /app
# Build identity (default "dev" locally): surfaced by GET /healthz so the
# auto-deploy (#29) can verify the running container is this exact image.
ARG GIT_SHA="dev"
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
COPY words words
COPY COPYING COPYING

# List integrity first: pinned enz/german-wordlist or the build stops.
RUN echo "20095928ca70974fb5d86e44f10181cee16e2831b0d4b1a4ddd12c261aebc5e9  words" | sha256sum -c -

RUN npm install --no-audit --no-fund \
 && npm run typecheck \
 && npm test \
 && npm run build \
 && npm run build-dawg \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production WORDAMENT_GIT_SHA=${GIT_SHA}
RUN addgroup -S wordament && adduser -S wordament -G wordament
COPY --from=build --chown=wordament:wordament /app /app
ENV PORT=3000 WORDAMENT_STATIC_DIR=/app/packages/client/dist
EXPOSE 3000
USER wordament
CMD ["node", "packages/server/dist/main.js"]
