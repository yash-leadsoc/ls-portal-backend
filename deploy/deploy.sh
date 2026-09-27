#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image-uri>}"
APP_DIR=/opt/ls-portal
cd "$APP_DIR"

set -a
source ./host.env
set +a

umask 077
aws ssm get-parameter --region "$AWS_REGION" --name "$ENV_PARAM" --with-decryption \
  --query Parameter.Value --output text > app.env.new
mv app.env.new app.env

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${IMAGE%%/*}" >/dev/null

PREVIOUS="$(cat .current_image 2>/dev/null || true)"

export API_IMAGE="$IMAGE"
docker compose pull api
docker compose up -d --remove-orphans || true

status=starting
for _ in $(seq 1 36); do
  status="$(docker inspect -f '{{.State.Health.Status}}' ls-portal-api 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && break
  sleep 5
done

if [ "$status" != "healthy" ]; then
  echo "Deployment of $IMAGE failed health check (status: $status)."
  docker logs --tail 80 ls-portal-api 2>&1 || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$IMAGE" ]; then
    echo "Rolling back to $PREVIOUS"
    export API_IMAGE="$PREVIOUS"
    docker compose up -d --remove-orphans
  fi
  exit 1
fi

echo "$IMAGE" > .current_image
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
echo "Deployed $IMAGE"
