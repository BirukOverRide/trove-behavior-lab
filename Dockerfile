# Trove on Railway (Node API + React UI + Python Tiny AI)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    build-essential python3-dev \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python ML
COPY ml_transformer/requirements.txt /app/ml_transformer/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /app/ml_transformer/requirements.txt \
  || pip3 install --break-system-packages --no-cache-dir numpy

# Server deps (native better-sqlite3 builds here)
COPY server/package.json server/package-lock.json /app/server/
RUN cd /app/server && npm ci --omit=dev

# Client deps + production build
COPY client/package.json client/package-lock.json /app/client/
RUN cd /app/client && npm ci
COPY client/ /app/client/
RUN cd /app/client && npm run build

# App source (server + ml + remaining)
COPY server/ /app/server/
COPY ml_transformer/ /app/ml_transformer/

# SQLite lives here (Railway volume optional; ephemeral OK for demo)
RUN mkdir -p /app/server/db/data /app/server/logs \
    /app/ml_transformer/models/runs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHON=python3
# Free/trial: don't melt the dyno — train manually from admin if needed
ENV AUTO_TRAIN=0

WORKDIR /app/server
EXPOSE 8000

CMD ["node", "server.js"]
