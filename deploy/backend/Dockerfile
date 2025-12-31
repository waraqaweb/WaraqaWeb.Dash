# syntax=docker/dockerfile:1.6
FROM node:20-alpine

WORKDIR /app

ARG APP_VERSION
ARG BUILD_TIME

# Install dependencies first (better layer caching)
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# Copy backend source
COPY backend/ ./

ENV NODE_ENV=production
ENV PORT=5000
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_TIME=${BUILD_TIME}

EXPOSE 5000

CMD ["npm", "start"]
