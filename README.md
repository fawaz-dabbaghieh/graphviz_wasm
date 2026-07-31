# Bandage Layout JS

WebAssembly port of Bandage graph layout engine for JavaScript/TypeScript.
This was originally forked from https://github.com/cmdcolin/BandageJS.
What has been/being added:
* The way paths and edges are interpreted, originally if the edges was written in both direction, then the nodes were being duplicated, not anymore
* Adding support for indexed graphs with gfaidx, which allows the user to jump around in huge graphs and visualize smaller parts of the graph instantly
* Including backend API for gfaidx


## Overview

This is a high-performance WebAssembly compilation of the Bandage graph layout algorithm using OGDF (Open Graph Drawing Framework) and Emscripten. It provides near-native C++ performance for laying out De Bruijn assembly graphs in web applications.

## Features

- **Fast**: Compiled to WebAssembly for ~90-95% native C++ performance
- **Web Worker Support**: Non-blocking graph layout in background threads
- **OGDF FMMM Algorithm**: Uses the proven Fast Multipole Multilevel Method for force-directed layout
- **Minimal Dependencies**: Self-contained WASM module

## Architecture

```
├── frontend/      # React/Vite web visualizer
├── backend/       # FastAPI service for server-side graph requests
├── src/           # C++ source files for the WASM layout engine
├── include/       # C++ headers for the WASM layout engine
├── js/            # Built JavaScript/WASM wrapper used by the frontend
└── examples/      # Usage examples for the layout package
```

## Local Development

The app currently runs as two local services:

- The frontend is the React/Vite visualizer.
- The backend is a FastAPI API that runs controlled server-side `gfaidx`
  extraction commands.

For the current backend integration, the browser calls `GET /api/graphs` to
load the server-side graph registry, then calls `POST /api/extract-subgraph` or
`POST /api/extract-region`. The backend runs controlled `gfaidx` commands
against registered indexed graphs and returns the extracted GFA to the
visualizer.

### Quick Conda Test

Create and activate the test environment:

```bash
conda env create -f environment.yml
conda activate graphviz-wasm
```

Start both the backend and frontend from the repository root:

```bash
./run_dev.sh
```

Open the frontend URL printed by Vite, usually:

```text
http://127.0.0.1:5173
```

The script uses `gfaidx` from the active Conda environment and sets the
frontend backend URL to `http://127.0.0.1:8000`.

To test from another device on the same network:

```bash
./run_dev.sh --host
```

The script binds both services to all network interfaces, detects the laptop's
LAN IP, and prints the frontend URL to open on another device. Browser API
requests use the same frontend address and are proxied internally to FastAPI,
so the other device only needs network access to the frontend port.

If automatic address detection chooses the wrong network interface, specify the
address explicitly:

```bash
LAN_IP=192.168.1.25 ./run_dev.sh --host
```

### Manual Setup

If you do not want to use `environment.yml`, install packages manually.

Inside your Conda environment, install Python and Node tooling:

```bash
conda activate bandagejs
conda install -c conda-forge python nodejs fastapi uvicorn
```

Alternatively, if Python and Node are already installed in the environment, only
install the backend Python dependencies:

```bash
pip install -r backend/requirements.txt
```

Then install the frontend JavaScript dependencies:

```bash
cd frontend
npm install
```

### Start The Backend

From the repository root:

```bash
conda activate bandagejs
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

The backend API will be available at:

```text
http://127.0.0.1:8000
```

### Start The Frontend

In a second terminal:

```bash
conda activate bandagejs
cd frontend
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

Use the graph selection panel in the left sidebar to extract either a
node-neighborhood subgraph or a coordinate-region subgraph from the backend. The
backend currently ships with a `chr22` registry entry and refuses requests above
10000 nodes.

## Dependencies Analysis

### Removed Qt Dependencies
- `QPointF` → `Point {double x, y}`
- `QString` → `std::string`
- `QList/QVector` → `std::vector`
- `QFile/QJson` → Custom JSON parser/writer
- `QFuture/QtConcurrent` → Removed (handled by Web Worker)

### Compiled with WASM
- OGDF library (force-directed layout algorithms)
- Minimal graph data structures
- Layout computation core

### Parameters (configurable from JS)
- `graphLayoutQuality`: 0-4 (controls iteration count)
- `useLinearLayout`: boolean
- `componentSeparation`: double
- `aspectRatio`: double
- `nodeLengthPerMegabase`: double
- `minimumNodeLength`: double
- `nodeSegmentLength`: double
- `edgeLength`: double

## Building

```bash
./layout_wasm/build.sh
```

Requires:
- Emscripten SDK (emsdk)
- CMake 3.10+
- OGDF library (included as submodule)

## Usage

### In Browser (Main Thread)

```javascript
import { BandageLayout } from './js/bandage-layout.js';

const layout = new BandageLayout();
await layout.init();

const result = layout.computeLayout(graphData, {
  quality: 2,
  linearLayout: false,
  componentSeparation: 15.0
});

console.log(result.nodePositions);
```

### With Web Worker (Recommended)

```javascript
import { BandageLayoutWorker } from './js/bandage-layout-worker.js';

const worker = new BandageLayoutWorker();

worker.onProgress((progress) => {
  console.log(`Layout: ${progress}%`);
});

const result = await worker.computeLayout(graphData, options);
console.log(result.nodePositions);
```

## Graph Data Format

Input graph structure:
```javascript
{
  nodes: [
    { id: "1+", name: "NODE_1", length: 5000, depth: 12.5 },
    { id: "1-", name: "NODE_1", length: 5000, depth: 12.5 },
    // ...
  ],
  edges: [
    { from: "1+", to: "2+", overlap: 0, type: "normal" },
    // ...
  ]
}
```

Output layout:
```javascript
{
  nodePositions: {
    "1+": [{ x: 0.0, y: 0.0 }, { x: 10.5, y: 0.2 }], // segment points
    "2+": [{ x: 12.0, y: 0.5 }, { x: 22.3, y: 1.1 }],
    // ...
  }
}
```

## Performance

Expected performance for typical assembly graphs:
- Small graphs (<1000 nodes): <100ms
- Medium graphs (1000-5000 nodes): 100ms-1s
- Large graphs (5000-10000 nodes): 1-5s
- Very large graphs (>10000 nodes): 5-30s

Performance is ~90-95% of native C++ Bandage.

## License

GPLv3 (same as Bandage)
