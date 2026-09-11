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
├── backend/       # Retained legacy FastAPI service
├── src/           # C++ source files for the WASM layout engine
├── include/       # C++ headers for the WASM layout engine
├── js/            # Built JavaScript/WASM wrapper used by the frontend
└── examples/      # Usage examples for the layout package
```

## Local Development With The Go Backend

The `go_backend` frontend uses the MMseqs2-App Go service as a separate HTTP
API. The browser discovers server-owned indexed graphs, submits a read-only
`gfaidx` query, polls the returned ticket, and downloads the GFA after the job
is complete:

- `GET /api/gfaidx/graphs`
- `GET /api/gfaidx/graphs/{graph_id}/region-paths`
- `POST /api/ticket/gfaidx/subgraph` or `/api/ticket/gfaidx/region`
- `GET /api/ticket/{ticket}` until its status is `COMPLETE` or `ERROR`
- `GET /api/result/gfaidx/{ticket}` for the completed GFA

BED/TSV annotations are selected from the user's laptop with **Load BED/TSV**;
the frontend does not request annotation files stored on the server.

### 1. Start The Go Backend

The gfaidx routes are only registered when the backend runs as `app:
"foldseek"` — `server.go` gates `RegisterGfaidxApi` on `config.App ==
AppFoldseek && config.Gfaidx != nil`. Starting the backend with `-app mmseqs`
(as earlier revisions of this file suggested) leaves every `/api/gfaidx/*`
and `/api/ticket/gfaidx/*` route unregistered, and the frontend's requests
will 404.

Running as `foldseek` normally also requires the Foldseek/FoldMason/FoldDisco
binaries, since `CheckPaths` checks every binary needed by the configured app
unless `local.delegate` excludes it. `local.delegate` is a slice field, and
the backend's CLI flag parser only supports scalar (string/bool/number)
fields — passing `-local.delegate ...` panics with `leaf node type not
implemented`. A JSON config file is the only way to set `local.delegate`, so
that's what delegates away the unused Foldseek job types and leaves only the
gfaidx worker active locally.

The example below uses the ignored development data in
`MMseqs2-App/gfaidx_test`. From the MMseqs2-App repository:

```bash
conda activate mmseqs2-app
mkdir -p /private/tmp/mmseqs-gfaidx-api/{databases,jobs,tmp}
```

Save the following as `/private/tmp/mmseqs-gfaidx-api/config.json`, adjusting
the absolute paths for your machine:

```json
{
  "app": "foldseek",
  "server": {
    "address": "127.0.0.1:18081",
    "pathprefix": "/api",
    "cors": true
  },
  "paths": {
    "databases": "/private/tmp/mmseqs-gfaidx-api/databases",
    "results": "/private/tmp/mmseqs-gfaidx-api/jobs",
    "temporary": "/private/tmp/mmseqs-gfaidx-api/tmp"
  },
  "local": {
    "workers": 1,
    "checkold": true,
    "delegate": [
      "search", "index", "msa", "nuclmsa", "pair",
      "structuresearch", "rnasearch", "complexsearch", "interfacesearch",
      "foldmasoneasymsa", "folddisco"
    ]
  },
  "gfaidx": {
    "binary": "/path/to/MMseqs2-App/gfaidx_test/bin/gfaidx",
    "databases": "/path/to/MMseqs2-App/gfaidx_test",
    "timeoutseconds": 120,
    "maxthreads": 2
  }
}
```

`local.delegate` lists every MMseqs/Foldseek job type so the local process
never needs those binaries; `gfaidx` is deliberately left off the list so it
keeps running on this machine. `gfaidx.binary`/`gfaidx.databases` follow the
same `~`-relative convention as the other binary paths.

Then start the backend from the MMseqs2-App repository:

```bash
cd backend
go run . -local -config /private/tmp/mmseqs-gfaidx-api/config.json
```

Graphs are registered by server-controlled `<graph-id>.params` files; graph
file paths are never accepted from browser requests.

Confirm that the backend can see the test graph:

```bash
curl http://127.0.0.1:18081/api/gfaidx/graphs
```

### 2. Start The Frontend

In a second terminal, from this repository:

```bash
conda activate graphviz-wasm
cd frontend
npm install
VITE_BACKEND_URL=http://127.0.0.1:18081 \
  VITE_PREFER_BACKEND_URL=true \
  npm run dev
```

Open `http://127.0.0.1:5173`. Choose a registered graph in **Graph Selection**,
then submit a node-neighborhood or coordinate-region extraction. While it is in
progress, the panel displays the ticket ID and whether it is queued, running, or
downloading. While a ticket is `PENDING` or `RUNNING`, the frontend waits one
second between status requests; requests do not overlap. The completed GFA is
loaded directly into the visualizer.

`VITE_PREFER_BACKEND_URL=true` is useful during testing because it ignores an
older backend address saved in browser local storage. The backend address can
also be changed from the **Backend** field at the top of the app.

### Check A Job From The Command Line

Submitting a region directly shows the same API sequence used by the frontend:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  --data '{"graph_id":"chr22","reference":"CHM13","sequence":"chr22","start":1000000,"end":1001000,"max_nodes":20,"all_haplotypes":false}' \
  http://127.0.0.1:18081/api/ticket/gfaidx/region
```

Copy the returned `id`, then check and download it:

```bash
curl http://127.0.0.1:18081/api/ticket/TICKET_ID
curl -o result.gfa http://127.0.0.1:18081/api/result/gfaidx/TICKET_ID
```

The result endpoint returns the GFA only after the ticket is `COMPLETE`.

### Demonstrate It On The Local Network

Yes, another device on the same network can use the app. The simplest setup
keeps the Go backend bound to `127.0.0.1` and exposes only Vite; Vite proxies
`/api` requests to the backend.

Keep the Go backend from step 1 running in Terminal 1. In Terminal 2, stop the
existing Vite process with `Ctrl+C`, find the laptop's Wi-Fi address, and restart
the frontend in network mode:

```bash
cd /Users/fawaz/projects/graphviz_wasm/frontend
conda activate graphviz-wasm

LAPTOP_LAN_IP="$(ipconfig getifaddr en0)"

VITE_BACKEND_URL="http://${LAPTOP_LAN_IP}:5173" \
  VITE_PREFER_BACKEND_URL=true \
  VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:18081 \
  npm run dev -- --host 0.0.0.0 --port 5173
```

Vite prints a **Network** URL such as `http://192.168.1.25:5173`. Open that URL
on the other device; do not use `localhost` or `0.0.0.0` there. If `en0` does not
return an address, try `ipconfig getifaddr en1` and set `LAPTOP_LAN_IP` to that
value. Both devices must be on the same network, and the laptop firewall must
allow incoming connections to Vite.

Alternatively, bind the Go backend itself with
`-server.address 0.0.0.0:18081`, keep `-server.cors true`, and configure the
frontend to use `http://192.168.1.25:18081`. This exposes both ports. These
development configurations have no authentication by default, so use them only
on a trusted LAN and do not expose them directly to the public internet.

### Retained Python Backend

The existing `backend/` FastAPI implementation and `run_dev.sh` are intentionally
still present for now. They use the older immediate-response endpoints; the
`go_backend` frontend flow documented above targets the Go ticket API. They can
be removed separately after the Go integration has settled.

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
  linearLayout: true,
  referencePathName: 'CHM13#0#chr22',
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
