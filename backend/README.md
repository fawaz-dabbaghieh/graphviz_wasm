# Backend

This directory is reserved for the API service that will run `gfaidx` on
server-side indexed graphs and return extracted GFA subgraphs to the frontend.

Planned minimal shape:

- `app/main.py`: API entry point.
- `app/gfaidx_runner.py`: safe wrapper around the `gfaidx` command.
- `graphs.yaml`: whitelist of graph IDs and index paths available to users.

Keep user requests constrained to graph IDs and validated extraction parameters;
do not accept raw filesystem paths or shell commands from the browser.
