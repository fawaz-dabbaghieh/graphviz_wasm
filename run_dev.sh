#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./run_dev.sh [--host]

Options:
  --host, --lan  Expose the frontend and backend on the local network.
  -h, --help     Show this help message.

Environment overrides:
  LAN_IP         Address advertised to browsers in host mode.
  BACKEND_HOST   Backend bind address.
  BACKEND_PORT   Backend port.
  FRONTEND_HOST  Frontend bind address.
  FRONTEND_PORT  Frontend port.
EOF
}

LAN_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host | --lan)
      LAN_MODE=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

detect_lan_ip() {
  local address=""
  local default_interface=""

  # Linux commonly exposes the selected outbound address through `ip route`.
  if command -v ip >/dev/null 2>&1; then
    address="$(
      ip route get 1.1.1.1 2>/dev/null |
        awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}' ||
        true
    )"
  fi

  # macOS exposes IPv4 addresses through ipconfig and a network interface name.
  if [[ -z "${address}" ]] &&
    command -v route >/dev/null 2>&1 &&
    command -v ipconfig >/dev/null 2>&1; then
    default_interface="$(
      route -n get default 2>/dev/null |
        awk '/interface:/{print $2; exit}' ||
        true
    )"
    if [[ -n "${default_interface}" ]]; then
      address="$(ipconfig getifaddr "${default_interface}" 2>/dev/null || true)"
    fi
  fi

  # Some macOS configurations do not expose the default route to a shell.
  if [[ -z "${address}" ]] && command -v ipconfig >/dev/null 2>&1; then
    for default_interface in en0 en1 en2; do
      address="$(ipconfig getifaddr "${default_interface}" 2>/dev/null || true)"
      [[ -n "${address}" ]] && break
    done
  fi

  # `hostname -I` provides a final portable fallback on many Linux systems.
  if [[ -z "${address}" ]] && command -v hostname >/dev/null 2>&1; then
    address="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi

  printf '%s' "${address}"
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if [[ "${LAN_MODE}" == true ]]; then
  BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
  FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
else
  BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
  FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
fi

LAN_IP="${LAN_IP:-}"
if [[ "${BACKEND_HOST}" == "0.0.0.0" || "${FRONTEND_HOST}" == "0.0.0.0" ]]; then
  LAN_IP="${LAN_IP:-$(detect_lan_ip)}"
  if [[ -z "${LAN_IP}" ]]; then
    echo "Could not detect this machine's LAN IP. Set LAN_IP and try again." >&2
    exit 1
  fi
fi

# 0.0.0.0 is a bind address, not the destination that another browser should use.
if [[ "${BACKEND_HOST}" == "0.0.0.0" ]]; then
  BACKEND_URL="${VITE_BACKEND_URL:-http://${LAN_IP}:${BACKEND_PORT}}"
  BACKEND_PROXY_HOST="127.0.0.1"
else
  BACKEND_URL="${VITE_BACKEND_URL:-http://${BACKEND_HOST}:${BACKEND_PORT}}"
  BACKEND_PROXY_HOST="${BACKEND_HOST}"
fi

if [[ "${FRONTEND_HOST}" == "0.0.0.0" ]]; then
  FRONTEND_URL="http://${LAN_IP}:${FRONTEND_PORT}"
else
  FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"
fi

if [[ "${LAN_MODE}" == true && -z "${VITE_BACKEND_URL:-}" ]]; then
  FRONTEND_BACKEND_URL="${FRONTEND_URL}"
  PREFER_CONFIGURED_BACKEND=true
else
  FRONTEND_BACKEND_URL="${BACKEND_URL}"
  PREFER_CONFIGURED_BACKEND=false
fi

if [[ -z "${CONDA_PREFIX:-}" ]]; then
  echo "No active Conda environment was detected." >&2
  echo "Create and activate the project environment first:" >&2
  echo "  conda env create -f environment.yml" >&2
  echo "  conda activate graphviz-wasm" >&2
  exit 1
fi

if ! command -v gfaidx >/dev/null 2>&1; then
  echo "gfaidx was not found in the active Conda environment: ${CONDA_PREFIX}" >&2
  echo "Install it before starting the app:" >&2
  echo "  conda install -c conda-forge -c bioconda 'gfaidx>=1.7.0'" >&2
  echo "Or update this environment from the repository file:" >&2
  echo "  conda env update -f environment.yml" >&2
  exit 1
fi

GFAIDX_PATH="$(command -v gfaidx)"
case "${GFAIDX_PATH}" in
  "${CONDA_PREFIX}/bin/"*) ;;
  *)
    echo "gfaidx resolves outside the active Conda environment:" >&2
    echo "  ${GFAIDX_PATH}" >&2
    echo "Install gfaidx into ${CONDA_PREFIX} before starting the app:" >&2
    echo "  conda install -c conda-forge -c bioconda 'gfaidx>=1.7.0'" >&2
    exit 1
    ;;
esac

if ! GFAIDX_VERSION="$("${GFAIDX_PATH}" --version 2>&1)"; then
  echo "The Conda gfaidx executable could not be run: ${GFAIDX_PATH}" >&2
  echo "${GFAIDX_VERSION}" >&2
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

wait_for_backend() {
  local health_url="http://${BACKEND_PROXY_HOST}:${BACKEND_PORT}/api/graphs"

  for _ in {1..50}; do
    if python -c \
      'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=0.25).close()' \
      "${health_url}" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
      return 1
    fi
    sleep 0.1
  done

  return 1
}

cd "${ROOT_DIR}"

echo "Starting backend on ${BACKEND_HOST}:${BACKEND_PORT}"
echo "Using gfaidx: ${GFAIDX_PATH}"
echo "${GFAIDX_VERSION}"
GFAIDX_BINARY="${GFAIDX_PATH}" \
  python -m uvicorn backend.app.main:app \
    --host "${BACKEND_HOST}" \
    --port "${BACKEND_PORT}" \
    --reload &
BACKEND_PID=$!

if ! wait_for_backend; then
  echo "Backend failed to become available on port ${BACKEND_PORT}." >&2
  exit 1
fi
echo "Backend health check passed"

echo "Installing/updating frontend dependencies"
cd "${ROOT_DIR}/frontend"
npm install --no-audit

if [[ "${FRONTEND_HOST}" == "0.0.0.0" ]]; then
  echo "Open from another device: ${FRONTEND_URL}"
else
  echo "Open frontend: ${FRONTEND_URL}"
fi
if [[ "${FRONTEND_BACKEND_URL}" == "${FRONTEND_URL}" ]]; then
  echo "Backend API through frontend: ${FRONTEND_URL}/api"
fi
echo "Direct backend URL: ${BACKEND_URL}"
VITE_BACKEND_URL="${FRONTEND_BACKEND_URL}" \
  VITE_PREFER_BACKEND_URL="${PREFER_CONFIGURED_BACKEND}" \
  VITE_BACKEND_PROXY_TARGET="http://${BACKEND_PROXY_HOST}:${BACKEND_PORT}" \
  npm run dev -- \
    --host "${FRONTEND_HOST}" \
    --port "${FRONTEND_PORT}"
