#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_LOG=debug
npm run build
exec npx wrangler dev
