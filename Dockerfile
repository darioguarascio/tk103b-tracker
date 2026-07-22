ARG APP_VERSION=dev

FROM node:20-alpine AS web-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json ./web/
COPY server/package.json ./server/
RUN npm install -w web
COPY web ./web
RUN npm run build -w web

FROM node:20-alpine
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
RUN apk add --no-cache wget
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm install -w server --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY migrations ./migrations
COPY --from=web-build /app/web/dist ./web/dist
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "server/index.js"]
