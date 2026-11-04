FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build:web
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV API_PORT=7860
ENV APM_DATABASE_PATH=/data/agentic-project-manager.sqlite
EXPOSE 7860

CMD ["node", "backend/src/server.js"]
