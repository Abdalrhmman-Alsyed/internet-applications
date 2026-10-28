# One Dockerfile for every backend app: docker build --build-arg APP=users-service .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencies (shared, cached layer for all five images). postinstall runs prisma generate.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/users-service/prisma apps/users-service/prisma
COPY apps/products-service/prisma apps/products-service/prisma
COPY apps/orders-service/prisma apps/orders-service/prisma
COPY apps/notifications-service/prisma apps/notifications-service/prisma
RUN npm install -g npm@11.7.0 --no-audit --no-fund && npm ci --no-audit --no-fund

FROM deps AS runtime
ARG APP
ENV APP=${APP} NODE_ENV=production
COPY . .
RUN npx nest build ${APP} && sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
USER node
ENTRYPOINT ["./docker-entrypoint.sh"]
