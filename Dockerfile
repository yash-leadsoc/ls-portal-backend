FROM node:20-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu fonts-liberation && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 10000

CMD ["node", "src/server.js"]