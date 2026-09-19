FROM node:24.21.0-slim AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/auth/package.json apps/auth/package.json
RUN npm ci
COPY apps/auth apps/auth
RUN npm run build --workspace @range-remote/auth \
 && npm prune --omit=dev

FROM node:24.21.0-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/auth/package.json ./apps/auth/package.json
COPY --from=build /app/apps/auth/dist ./apps/auth/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8790
CMD ["node", "apps/auth/dist/index.js"]
