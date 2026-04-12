# syntax=docker/dockerfile:1.6
FROM node:20-alpine

# Chromium for whatsapp-web.js (puppeteer)
RUN apk add --no-cache chromium

WORKDIR /app

ARG APP_VERSION
ARG BUILD_VERSION
ARG BUILD_TIME

# Install dependencies first (better layer caching)
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# Copy backend source
COPY backend/ ./

ENV NODE_ENV=production
ENV PORT=5000
ENV BUILD_VERSION=${BUILD_VERSION}
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_TIME=${BUILD_TIME}

EXPOSE 5000

# Cap the V8 heap so Node triggers GC earlier and avoids OOM on small VPS.
ENV NODE_OPTIONS="--max-old-space-size=384"
# Tell puppeteer where Chromium lives (Alpine package)
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"

CMD ["npm", "start"]
