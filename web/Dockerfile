FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install -g npm@11.7.0 --no-audit --no-fund && npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=http://localhost:3004
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3001
CMD ["node", "server.js"]
