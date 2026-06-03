from pathlib import Path
import subprocess
import tempfile

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field


app = FastAPI(title="GraphViz WASM backend")

# During local development, the Vite frontend runs on a different port than the
# API. CORS lets that browser page call this backend without relaxing access for
# arbitrary origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Keep all executable and graph paths server-controlled. The browser can choose
# from graph IDs, but it never gets to provide filesystem paths or shell text.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
GFAIDX_BINARY = BACKEND_ROOT / "gfaidx_bin" / "gfaidx"
MAX_ALLOWED_NODES = 10_000
GRAPH_INDEXES = {
    "chr22": BACKEND_ROOT / "indexed_example" / "chr22.indexed.gfa.gz",
}


class SubgraphRequest(BaseModel):
    graph_id: str = Field(..., description="Whitelisted graph ID to query")
    start_node: str = Field(..., min_length=1, description="Starting node ID")
    max_nodes: int = Field(..., ge=1)


@app.post("/api/extract-subgraph", response_class=PlainTextResponse)
def extract_subgraph(request: SubgraphRequest) -> str:
    """Run gfaidx against a whitelisted graph and return the extracted GFA."""
    graph_path = GRAPH_INDEXES.get(request.graph_id)
    if graph_path is None:
        raise HTTPException(status_code=404, detail="Unknown graph selection")

    if not request.start_node.strip():
        raise HTTPException(status_code=400, detail="Start node ID is required")

    if request.max_nodes > MAX_ALLOWED_NODES:
        raise HTTPException(
            status_code=400,
            detail=f"Neighborhood size is limited to {MAX_ALLOWED_NODES} nodes",
        )

    if not GFAIDX_BINARY.exists():
        raise HTTPException(status_code=500, detail="gfaidx binary was not found")

    if not graph_path.exists():
        raise HTTPException(status_code=500, detail="Indexed graph was not found")

    try:
        with tempfile.TemporaryDirectory(prefix="gfaidx-subgraph-") as tmp_dir:
            output_path = Path(tmp_dir) / "subgraph.gfa"

            # gfaidx currently writes to an output file, so the API uses a
            # temporary file and then returns its contents. Keep the command as
            # an argument list so user-provided node IDs cannot become shell
            # syntax.
            subprocess.run(
                [
                    str(GFAIDX_BINARY),
                    "get_subgraph",
                    str(graph_path),
                    request.start_node.strip(),
                    str(output_path),
                    "--max_nodes",
                    str(request.max_nodes),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )

            if not output_path.exists():
                raise HTTPException(status_code=500, detail="gfaidx produced no output file")

            gfa_text = output_path.read_text(encoding="utf-8")
            if not gfa_text.strip():
                raise HTTPException(status_code=500, detail="gfaidx returned an empty GFA")

            return gfa_text

    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="gfaidx extraction timed out") from exc
    except subprocess.CalledProcessError as exc:
        command_output = "\n".join(
            part.strip() for part in [exc.stdout, exc.stderr] if part and part.strip()
        )
        if "Start node was not found" in command_output:
            # For early testing, surface gfaidx's own message directly so the
            # UI shows exactly what the command reported.
            raise HTTPException(status_code=404, detail=command_output) from exc

        raise HTTPException(
            status_code=500,
            detail=command_output or f"gfaidx failed with exit code {exc.returncode}",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
