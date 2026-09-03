# Backend

This directory is reserved for the API service that will run `gfaidx` on
server-side indexed graphs and return extracted GFA subgraphs to the frontend.

Current minimal shape:

- `app/main.py`: API entry point.
- `gfaidx` from the active Conda environment: executable used for extraction.
- `graphs.tsv`: server-controlled list of indexed graphs exposed to the UI.
- `annotations.tsv`: server-controlled list of BED/TSV annotation files exposed
  to the UI.
- `indexed_example/chr22.indexed.gfa.gz`: current indexed graph example.

Keep user requests constrained to graph IDs and validated extraction parameters;
do not accept raw filesystem paths or shell commands from the browser.

## Graph registry

Available backend graphs are configured in `backend/graphs.tsv`:

```tsv
graph_id	display_name	path	description
chr22	chr22	indexed_example/chr22.indexed.gfa.gz	CHM13 and GRCh38 chr22 indexed graph
```

Paths can be absolute or relative to `backend/`. The browser only sends
`graph_id`; filesystem paths remain server-controlled.

## Annotation registry

Available backend annotation files are configured in `backend/annotations.tsv`:

```tsv
annotation_id	display_name	path	description
chr22_ucsc_transcripts	chr22 UCSC transcripts	indexed_example/chr22_annotations.bed	UCSC chr22 transcript BED table
```

The frontend calls `GET /api/annotations` to populate the annotation dropdown
and `GET /api/annotations/{annotation_id}` to load the selected BED/TSV text.
The browser only sends `annotation_id`; filesystem paths remain
server-controlled.

## Local development

From the repository root, the simplest test path is:

```bash
conda env create -f environment.yml
conda activate graphviz-wasm
./run_dev.sh
```

This starts the FastAPI backend, starts the Vite frontend, and uses `gfaidx`
from the active Conda environment.

If this environment was created before `gfaidx` was added, update it first:

```bash
conda env update -f environment.yml
```

Then run the API server:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

If I want it to be accessible accross thre network, then I can run this

```bash
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

In another terminal, run the frontend:

```bash
cd frontend
npm run dev
```

The frontend graph controls call `GET /api/graphs` to populate the graph
dropdown and `POST /api/extract-subgraph` for node-neighborhood extraction. The
backend runs a controlled command equivalent to:

```bash
gfaidx get_subgraph \
  backend/indexed_example/chr22.indexed.gfa.gz \
  START_NODE \
  TMP_OUTPUT.gfa \
  --max_nodes MAX_NODES \
  [--with_coords]
```

The API reads `TMP_OUTPUT.gfa`, returns its GFA text to the browser, and deletes
the temporary file automatically. Requests are currently limited to the
registered graphs. `max_nodes` is still required and must be at least 1, but it
is not capped by the backend while we are testing larger graph sizes locally.
Set `with_coords` to `true` to request coordinate-bearing P/W subpaths.

For coordinate-region extraction, the frontend first calls:

```text
GET /api/graphs/{graph_id}/region-paths
```

The backend runs:

```bash
gfaidx get_region \
  backend/indexed_example/chr22.indexed.gfa.gz \
  --print_path_names
```

Then the frontend calls `POST /api/extract-region` with a selected coordinate
track, start, end, and max-node limit. The backend runs a command equivalent to:

```bash
gfaidx get_region \
  --reference REFERENCE \
  --max_nodes MAX_NODES \
  [--with_coords] \
  backend/indexed_example/chr22.indexed.gfa.gz \
  SEQUENCE:START-END \
  TMP_OUTPUT.gfa
```

Set `all_haplotypes` to `true` to replace the BFS limit with
`--all_haplotypes`. In that mode the backend omits `--max_nodes`; `max_nodes`
may therefore be omitted from the API request. `with_coords` can be enabled in
either region mode.
