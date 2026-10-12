#!/usr/bin/env bash
# Copies the new backend code into ~/app/backend, rebuilds the Docker image,
# restarts the container and rolls back to the previous image if it is unhealthy.
set -euo pipefail

RELEASE=/home/ubuntu/app/releases/backend
APP=/home/ubuntu/app/backend
IMAGE=ls-portal-api
NAME=ls-portal-api

mkdir -p "$APP"
rsync -a --exclude '.env' --exclude '.git' --exclude 'node_modules' "$RELEASE"/ "$APP"/
cd "$APP"

if [ ! -f .env ]; then
  echo "ERROR: $APP/.env is missing. Create it on the server first."
  exit 1
fi

if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:previous"
fi

docker build -t "$IMAGE:latest" .

run() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped --env-file .env \
    -e NODE_ENV=production -e PORT=10000 -p 127.0.0.1:10000:10000 \
    -v ls_uploads:/app/uploads --log-opt max-size=10m --log-opt max-file=3 \
    "$IMAGE:$1" >/dev/null
}

run latest

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:10000/api/health >/dev/null; then
    echo "New backend is healthy."
    docker image prune -f >/dev/null || true
    exit 0
  fi
  sleep 2
done

echo "ERROR: new backend did not become healthy. Last logs:"
docker logs --tail 60 "$NAME" || true
if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
  echo "Rolling back to the previous version..."
  run previous
fi
exit 1
