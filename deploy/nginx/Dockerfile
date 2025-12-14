FROM node:20-alpine AS dashboard_build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Ensure assets are built to work under /dashboard
ENV PUBLIC_URL=/dashboard
RUN npm run build


FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=dashboard_build /app/build /usr/share/nginx/html/dashboard
