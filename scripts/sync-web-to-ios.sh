#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
PNPM_COMMAND="${PNPM_COMMAND:-pnpm}"

cd "${PROJECT_DIRECTORY}/web"
"${PNPM_COMMAND}" build

rm -rf "${PROJECT_DIRECTORY}/ios/CarWashWebView/WebApp"
cp -R "${PROJECT_DIRECTORY}/web/dist" "${PROJECT_DIRECTORY}/ios/CarWashWebView/WebApp"

echo "React build copied to ios/CarWashWebView/WebApp"

