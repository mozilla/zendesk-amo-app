#!/usr/bin/env bash
set -euo pipefail

BASE_NAME="AMO User Info"
ENV="${NODE_ENV:-production}"

if [[ "$ENV" == "development" ]]; then
  APP_NAME="DEV-${BASE_NAME}"
  ZIP_NAME="app-dev.zip"
else
  APP_NAME="${BASE_NAME}"
  ZIP_NAME="app.zip"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Generate manifest.json
sed "s/{{APP_NAME}}/${APP_NAME}/" "$ROOT/manifest.template.json" > "$ROOT/manifest.json"
echo "manifest.json generated with name: \"${APP_NAME}\""

# Package ZIP
mkdir -p "$ROOT/dist"
cd "$ROOT"
zip -r "dist/${ZIP_NAME}" manifest.json assets/ translations/
echo "dist/${ZIP_NAME} created"
