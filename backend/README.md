# Backend

This directory is reserved for the API service that will run `gfaidx` on
server-side indexed graphs and return extracted GFA subgraphs to the frontend.

Current minimal shape:

- `app/main.py`: API entry point.
- `gfaidx_bin/gfaidx`: symlink or binary used for extraction.
- `indexed_example/chr22.indexed.gfa.gz`: currently whitelisted indexed graph.

Keep user requests constrained to graph IDs and validated extraction parameters;
do not accept raw filesystem paths or shell commands from the browser.

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

In another terminal, run the frontend:

```bash
cd frontend
npm run dev
```

The frontend extraction controls call `POST /api/extract-subgraph`. The backend
runs a controlled command equivalent to:

```bash
backend/gfaidx_bin/gfaidx get_subgraph \
  backend/indexed_example/chr22.indexed.gfa.gz \
  START_NODE \
  TMP_OUTPUT.gfa \
  --max_nodes MAX_NODES
```

The API reads `TMP_OUTPUT.gfa`, returns its GFA text to the browser, and deletes
the temporary file automatically. Requests are currently limited to the
whitelisted `chr22` graph and at most 10000 nodes.
