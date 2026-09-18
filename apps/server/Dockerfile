FROM node:24.21.0-slim AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm install
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace @range-remote/shared \
 && npm run build --workspace @range-remote/server

FROM node:24.21.0-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "apps/server/dist/index.js"]
