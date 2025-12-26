FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Build-time environment values baked into the bundle
ARG REACT_APP_API_URL
ARG REACT_APP_SOCKET_URL
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_SOCKET_URL=${REACT_APP_SOCKET_URL}

# Vite build is configured to output to build/ and use base=/dashboard/
ENV NODE_OPTIONS=--max_old_space_size=2048
RUN npm run build


FROM nginx:1.27-alpine

COPY deploy/frontend/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html/dashboard
