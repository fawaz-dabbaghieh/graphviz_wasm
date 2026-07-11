# Backend

This directory is reserved for the API service that will run `gfaidx` on
server-side indexed graphs and return extracted GFA subgraphs to the frontend.

Current minimal shape:

- `app/main.py`: API entry point.
- `gfaidx_bin/gfaidx`: symlink or binary used for extraction.
- `graphs.tsv`: server-controlled list of indexed graphs exposed to the UI.
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

## Local development

From the repository root, install the backend dependencies inside your Conda
environment if they are not already available:

```bash
pip install -r backend/requirements.txt
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
backend/gfaidx_bin/gfaidx get_subgraph \
  backend/indexed_example/chr22.indexed.gfa.gz \
  START_NODE \
  TMP_OUTPUT.gfa \
  --max_nodes MAX_NODES
```

The API reads `TMP_OUTPUT.gfa`, returns its GFA text to the browser, and deletes
the temporary file automatically. Requests are currently limited to the
registered graphs and at most 10000 nodes.

For coordinate-region extraction, the frontend first calls:

```text
GET /api/graphs/{graph_id}/region-paths
```

The backend runs:

```bash
backend/gfaidx_bin/gfaidx get_region \
  backend/indexed_example/chr22.indexed.gfa.gz \
  --print_path_names
```

Then the frontend calls `POST /api/extract-region` with a selected coordinate
track, start, end, and max-node limit. The backend runs a command equivalent to:

```bash
backend/gfaidx_bin/gfaidx get_region \
  --reference REFERENCE \
  --max_nodes MAX_NODES \
  backend/indexed_example/chr22.indexed.gfa.gz \
  SEQUENCE:START-END \
  TMP_OUTPUT.gfa
```
