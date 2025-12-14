FROM node:20-alpine

WORKDIR /app

COPY frontend/marketing-site/package.json frontend/marketing-site/package-lock.json ./
RUN npm ci

COPY frontend/marketing-site/ ./

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max_old_space_size=2048
RUN npm run build

EXPOSE 4000
CMD ["npm", "run", "start"]
