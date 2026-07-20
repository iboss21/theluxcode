# Like a King Inc. — website + operations console (Express). Runs on the VPS
# behind the Caddy reverse proxy defined in docker-compose.prod.yml.
FROM node:20-alpine

WORKDIR /app

# Install production deps only, from the lockfile (deterministic).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source (node_modules and data excluded via .dockerignore).
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Persistent CRM store lives on a named volume mounted at /data.
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server.js"]
