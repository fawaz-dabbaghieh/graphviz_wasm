# Backend

This directory is reserved for the API service that will run `gfaidx` on
server-side indexed graphs and return extracted GFA subgraphs to the frontend.

Planned minimal shape:

- `app/main.py`: API entry point.
- `app/gfaidx_runner.py`: safe wrapper around the `gfaidx` command.
- `graphs.yaml`: whitelist of graph IDs and index paths available to users.

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

The temporary "Backend Test" button calls `GET /api/test-text`. The backend runs
a controlled `cat backend/indexed_example/test.txt`-style subprocess on the
server and shows the command output in a browser alert.
