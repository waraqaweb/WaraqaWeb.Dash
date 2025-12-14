FROM node:20-alpine

WORKDIR /app

COPY frontend/marketing-site/package.json frontend/marketing-site/package-lock.json ./
RUN npm ci

COPY frontend/marketing-site/ ./

ENV NODE_ENV=production
RUN npm run build

EXPOSE 4000
CMD ["npm", "run", "start"]
