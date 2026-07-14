#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"

if ! command -v gfaidx >/dev/null 2>&1; then
  echo "gfaidx was not found on PATH. Activate the conda environment first." >&2
  exit 1
fi

if ! command -v python >/dev/null 2>&1; then
  echo "python was not found on PATH. Activate the conda environment first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found on PATH. Activate the conda environment first." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

echo "Starting backend at ${BACKEND_URL}"
GFAIDX_BINARY="$(command -v gfaidx)" \
  python -m uvicorn backend.app.main:app \
    --host "${BACKEND_HOST}" \
    --port "${BACKEND_PORT}" \
    --reload &
BACKEND_PID=$!

echo "Installing frontend dependencies if needed"
cd "${ROOT_DIR}/frontend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "Starting frontend at http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "Backend URL: ${BACKEND_URL}"
VITE_BACKEND_URL="${BACKEND_URL}" \
  npm run dev -- \
    --host "${FRONTEND_HOST}" \
    --port "${FRONTEND_PORT}"
