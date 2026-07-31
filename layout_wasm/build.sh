#!/usr/bin/env bash

# Bandage Layout JS Build Script
# Requires Emscripten SDK to be installed and activated

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OGDF_DIR="${SCRIPT_DIR}/thirdparty/ogdf"
BUILD_ROOT="${SCRIPT_DIR}/.build"
OGDF_BUILD_DIR="${BUILD_ROOT}/ogdf"
LAYOUT_BUILD_DIR="${BUILD_ROOT}/bandage-layout"
OUTPUT_DIR="${PROJECT_ROOT}/js"

if [[ -n "${BUILD_JOBS:-}" ]]; then
    BUILD_JOBS="${BUILD_JOBS}"
elif command -v nproc >/dev/null 2>&1; then
    BUILD_JOBS="$(nproc)"
elif command -v sysctl >/dev/null 2>&1; then
    BUILD_JOBS="$(sysctl -n hw.ncpu 2>/dev/null || true)"
else
    BUILD_JOBS=2
fi

BUILD_JOBS="${BUILD_JOBS:-2}"

echo "=== Bandage Layout JS Build Script ==="
echo ""

# Auto-detect and source Emscripten if needed
if ! command -v emcc &> /dev/null; then
    echo "Emscripten not in PATH, attempting to activate..."

    # Try common emsdk locations
    EMSDK_PATHS=(
        "$HOME/emsdk/emsdk_env.sh"
        "/opt/emsdk/emsdk_env.sh"
        "/usr/local/emsdk/emsdk_env.sh"
    )

    EMSDK_FOUND=false
    for EMSDK_PATH in "${EMSDK_PATHS[@]}"; do
        if [ -f "$EMSDK_PATH" ]; then
            echo "Found Emscripten at: $EMSDK_PATH"
            source "$EMSDK_PATH"
            EMSDK_FOUND=true
            break
        fi
    done

    if [ "$EMSDK_FOUND" = false ]; then
        echo "ERROR: emcc (Emscripten compiler) not found!"
        echo "Please install and activate Emscripten SDK:"
        echo "  git clone https://github.com/emscripten-core/emsdk.git"
        echo "  cd emsdk"
        echo "  ./emsdk install latest"
        echo "  ./emsdk activate latest"
        echo "  source ./emsdk_env.sh"
        exit 1
    fi
fi

echo "✓ Emscripten found: $(emcc --version | head -n 1)"
echo "✓ Parallel build jobs: ${BUILD_JOBS}"
echo ""

if [[ ! -f "${OGDF_DIR}/CMakeLists.txt" ]]; then
    echo "ERROR: OGDF source was not found at ${OGDF_DIR}" >&2
    exit 1
fi

echo "Configuring OGDF..."
emcmake cmake \
    -S "${OGDF_DIR}" \
    -B "${OGDF_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DOGDF_SEPARATE_TESTS=OFF

echo "Building OGDF..."
cmake --build "${OGDF_BUILD_DIR}" --parallel "${BUILD_JOBS}"
echo "✓ OGDF built successfully"
echo ""

# Build Bandage Layout
echo "Configuring Bandage Layout..."
emcmake cmake \
    -S "${PROJECT_ROOT}" \
    -B "${LAYOUT_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DOGDF_INCLUDE_DIR="${OGDF_DIR}/include" \
    -DOGDF_GENERATED_INCLUDE_DIR="${OGDF_BUILD_DIR}/include" \
    -DOGDF_LIBRARY="${OGDF_BUILD_DIR}/libOGDF.a" \
    -DCOIN_LIBRARY="${OGDF_BUILD_DIR}/libCOIN.a"

echo "Building Bandage Layout..."
cmake --build "${LAYOUT_BUILD_DIR}" --parallel "${BUILD_JOBS}"

# Copy output files to js directory
echo ""
echo "Copying output files to ${OUTPUT_DIR}/..."
mkdir -p "${OUTPUT_DIR}"
cp "${LAYOUT_BUILD_DIR}/bandage-layout.js" "${OUTPUT_DIR}/"
cp "${LAYOUT_BUILD_DIR}/bandage-layout.wasm" "${OUTPUT_DIR}/"

echo ""
echo "=== Build Complete! ==="
echo "Output files:"
echo "  - ${OUTPUT_DIR}/bandage-layout.js"
echo "  - ${OUTPUT_DIR}/bandage-layout.wasm"
echo ""
echo "Total WASM size: $(du -h "${OUTPUT_DIR}/bandage-layout.wasm" | cut -f1)"
echo ""
