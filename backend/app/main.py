from pathlib import Path
import subprocess

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse


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
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Keep this path server-controlled. The browser asks for the test text, but it
# never gets to provide a filesystem path that the backend should read.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
TEST_TEXT_PATH = BACKEND_ROOT / "indexed_example" / "test.txt"


@app.get("/api/test-text", response_class=PlainTextResponse)
def read_test_text() -> str:
    """Return the fixed test file by running a controlled command."""
    try:
        # This intentionally mirrors the future gfaidx flow: the backend runs a
        # known server-side command and returns stdout to the browser. Keep the
        # command as an argument list so user input cannot become shell syntax.
        completed = subprocess.run(
            ["cat", str(TEST_TEXT_PATH)],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return completed.stdout
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="test.txt was not found") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="test command timed out") from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"test command failed with exit code {exc.returncode}",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
