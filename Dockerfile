FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY apps ./apps
RUN DATABASE_URL=postgresql://build:build@localhost/build pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WORKER_PORT=3001
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node certs ./certs
COPY --chown=node:node infra/aws/database-roles.sql ./infra/aws/database-roles.sql
USER node
EXPOSE 3000 3001
CMD ["node", "dist/server/main.js"]
