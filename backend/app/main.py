import csv
from dataclasses import dataclass
import os
from pathlib import Path
import shutil
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
    allow_origin_regex=(
        r"^http://("
        r"localhost|127\.0\.0\.1|"
        r"10\.\d+\.\d+\.\d+|"
        r"192\.168\.\d+\.\d+|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+"
        r"):\d+$"
    ),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Keep all executable and graph paths server-controlled. The browser can choose
# from graph IDs, but it never gets to provide filesystem paths or shell text.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
GFAIDX_BINARY = Path(
    os.environ.get(
        "GFAIDX_BINARY",
        shutil.which("gfaidx") or str(BACKEND_ROOT / "gfaidx_bin" / "gfaidx"),
    )
)
GRAPH_REGISTRY_PATH = BACKEND_ROOT / "graphs.tsv"
ANNOTATION_REGISTRY_PATH = BACKEND_ROOT / "annotations.tsv"
GFAIDX_EXTRACTION_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class GraphRegistryEntry:
    graph_id: str
    display_name: str
    path: Path
    description: str = ""


@dataclass(frozen=True)
class AnnotationRegistryEntry:
    annotation_id: str
    display_name: str
    path: Path
    description: str = ""


class GraphInfo(BaseModel):
    id: str
    name: str
    description: str = ""


class AnnotationInfo(BaseModel):
    id: str
    name: str
    description: str = ""


class RegionPathInfo(BaseModel):
    source: str
    reference: str
    haplotype: str
    sequence: str
    start: int
    end: int
    entries: int
    label: str


class SubgraphRequest(BaseModel):
    graph_id: str = Field(..., description="Whitelisted graph ID to query")
    start_node: str = Field(..., min_length=1, description="Starting node ID")
    max_nodes: int = Field(..., ge=1)


class RegionRequest(BaseModel):
    graph_id: str = Field(..., description="Whitelisted graph ID to query")
    sequence: str = Field(..., min_length=1, description="Reference sequence name")
    start: int = Field(..., ge=0, description="0-based inclusive start")
    end: int = Field(..., ge=1, description="0-based exclusive end")
    max_nodes: int = Field(..., ge=1)
    reference: str = Field("", description="Reference sample name")


def command_output_from_error(exc: subprocess.CalledProcessError) -> str:
    return "\n".join(
        part.strip() for part in [exc.stdout, exc.stderr] if part and part.strip()
    )


def load_graph_registry() -> dict[str, GraphRegistryEntry]:
    if not GRAPH_REGISTRY_PATH.exists():
        raise HTTPException(status_code=500, detail="Graph registry was not found")

    graph_entries: dict[str, GraphRegistryEntry] = {}
    with GRAPH_REGISTRY_PATH.open(newline="", encoding="utf-8") as registry_file:
        reader = csv.DictReader(registry_file, delimiter="\t")
        required_columns = {"graph_id", "display_name", "path"}
        fieldnames = set(reader.fieldnames or [])
        missing_columns = sorted(required_columns - fieldnames)
        if missing_columns:
            raise HTTPException(
                status_code=500,
                detail=f"Graph registry is missing columns: {', '.join(missing_columns)}",
            )

        for line_number, row in enumerate(reader, start=2):
            graph_id = (row.get("graph_id") or "").strip()
            display_name = (row.get("display_name") or "").strip()
            raw_path = (row.get("path") or "").strip()
            description = (row.get("description") or "").strip()

            if not graph_id or not display_name or not raw_path:
                raise HTTPException(
                    status_code=500,
                    detail=f"Graph registry has an incomplete row at line {line_number}",
                )

            graph_path = Path(raw_path)
            if not graph_path.is_absolute():
                graph_path = BACKEND_ROOT / graph_path

            if graph_id in graph_entries:
                raise HTTPException(
                    status_code=500,
                    detail=f"Graph registry contains duplicate graph ID: {graph_id}",
                )

            graph_entries[graph_id] = GraphRegistryEntry(
                graph_id=graph_id,
                display_name=display_name,
                path=graph_path.resolve(),
                description=description,
            )

    return graph_entries


def get_graph_entry(graph_id: str) -> GraphRegistryEntry:
    graph_entry = load_graph_registry().get(graph_id)
    if graph_entry is None:
        raise HTTPException(status_code=404, detail="Unknown graph selection")

    if not graph_entry.path.exists():
        raise HTTPException(status_code=500, detail="Indexed graph was not found")

    return graph_entry


def load_annotation_registry() -> dict[str, AnnotationRegistryEntry]:
    if not ANNOTATION_REGISTRY_PATH.exists():
        raise HTTPException(status_code=500, detail="Annotation registry was not found")

    annotation_entries: dict[str, AnnotationRegistryEntry] = {}
    with ANNOTATION_REGISTRY_PATH.open(newline="", encoding="utf-8") as registry_file:
        reader = csv.DictReader(registry_file, delimiter="\t")
        required_columns = {"annotation_id", "display_name", "path"}
        fieldnames = set(reader.fieldnames or [])
        missing_columns = sorted(required_columns - fieldnames)
        if missing_columns:
            raise HTTPException(
                status_code=500,
                detail=f"Annotation registry is missing columns: {', '.join(missing_columns)}",
            )

        for line_number, row in enumerate(reader, start=2):
            annotation_id = (row.get("annotation_id") or "").strip()
            display_name = (row.get("display_name") or "").strip()
            raw_path = (row.get("path") or "").strip()
            description = (row.get("description") or "").strip()

            if not annotation_id or not display_name or not raw_path:
                raise HTTPException(
                    status_code=500,
                    detail=f"Annotation registry has an incomplete row at line {line_number}",
                )

            annotation_path = Path(raw_path)
            if not annotation_path.is_absolute():
                annotation_path = BACKEND_ROOT / annotation_path

            if annotation_id in annotation_entries:
                raise HTTPException(
                    status_code=500,
                    detail=f"Annotation registry contains duplicate annotation ID: {annotation_id}",
                )

            annotation_entries[annotation_id] = AnnotationRegistryEntry(
                annotation_id=annotation_id,
                display_name=display_name,
                path=annotation_path.resolve(),
                description=description,
            )

    return annotation_entries


def get_annotation_entry(annotation_id: str) -> AnnotationRegistryEntry:
    annotation_entry = load_annotation_registry().get(annotation_id)
    if annotation_entry is None:
        raise HTTPException(status_code=404, detail="Unknown annotation selection")

    if not annotation_entry.path.exists():
        raise HTTPException(status_code=500, detail="Annotation file was not found")

    return annotation_entry


def ensure_gfaidx_binary() -> None:
    if not GFAIDX_BINARY.exists():
        raise HTTPException(status_code=500, detail="gfaidx binary was not found")


def read_gfaidx_output(output_path: Path) -> str:
    if not output_path.exists():
        raise HTTPException(status_code=500, detail="gfaidx produced no output file")

    gfa_text = output_path.read_text(encoding="utf-8")
    if not gfa_text.strip():
        raise HTTPException(status_code=500, detail="gfaidx returned an empty GFA")

    return gfa_text


def parse_region_paths(command_output: str) -> list[RegionPathInfo]:
    lines = [line for line in command_output.splitlines() if line.strip()]
    header_index = next(
        (index for index, line in enumerate(lines) if line.startswith("source\t")),
        None,
    )
    if header_index is None:
        raise HTTPException(
            status_code=500,
            detail="gfaidx did not return a region path table",
        )

    reader = csv.DictReader(lines[header_index:], delimiter="\t")
    region_paths: list[RegionPathInfo] = []
    for row in reader:
        try:
            start = int(row["start"])
            end = int(row["end"])
            entries = int(row["entries"])
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=500,
                detail="gfaidx returned an invalid region path table",
            ) from exc

        reference = (row.get("reference") or "").strip()
        haplotype = (row.get("haplotype") or "").strip()
        sequence = (row.get("sequence") or "").strip()
        source = (row.get("source") or "").strip()
        haplotype_suffix = f" hap{haplotype}" if haplotype else ""
        label = f"{reference}{haplotype_suffix} {sequence} ({start}-{end})".strip()

        region_paths.append(
            RegionPathInfo(
                source=source,
                reference=reference,
                haplotype=haplotype,
                sequence=sequence,
                start=start,
                end=end,
                entries=entries,
                label=label,
            )
        )

    return region_paths


@app.get("/api/graphs", response_model=list[GraphInfo])
def list_graphs() -> list[GraphInfo]:
    """Return the server-controlled indexed graphs that the UI can query."""
    return [
        GraphInfo(
            id=entry.graph_id,
            name=entry.display_name,
            description=entry.description,
        )
        for entry in load_graph_registry().values()
    ]


@app.get("/api/annotations", response_model=list[AnnotationInfo])
def list_annotations() -> list[AnnotationInfo]:
    """Return the server-controlled BED files that the UI can load."""
    return [
        AnnotationInfo(
            id=entry.annotation_id,
            name=entry.display_name,
            description=entry.description,
        )
        for entry in load_annotation_registry().values()
    ]


@app.get("/api/annotations/{annotation_id}", response_class=PlainTextResponse)
def get_annotation(annotation_id: str) -> str:
    """Return a whitelisted BED/TSV annotation file as plain text."""
    annotation_entry = get_annotation_entry(annotation_id)

    try:
        return annotation_entry.path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail="Annotation file is not valid UTF-8 text",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/graphs/{graph_id}/region-paths", response_model=list[RegionPathInfo])
def list_region_paths(graph_id: str) -> list[RegionPathInfo]:
    """Return coordinate tracks available for gfaidx get_region."""
    graph_entry = get_graph_entry(graph_id)
    ensure_gfaidx_binary()

    try:
        result = subprocess.run(
            [
                str(GFAIDX_BINARY),
                "get_region",
                str(graph_entry.path),
                "--print_path_names",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="gfaidx path listing timed out") from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=command_output_from_error(exc)
            or f"gfaidx failed with exit code {exc.returncode}",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return parse_region_paths(result.stdout)


@app.post("/api/extract-subgraph", response_class=PlainTextResponse)
def extract_subgraph(request: SubgraphRequest) -> str:
    """Run gfaidx against a whitelisted graph and return the extracted GFA."""
    graph_entry = get_graph_entry(request.graph_id)

    if not request.start_node.strip():
        raise HTTPException(status_code=400, detail="Start node ID is required")

    ensure_gfaidx_binary()

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
                    str(graph_entry.path),
                    request.start_node.strip(),
                    str(output_path),
                    "--max_nodes",
                    str(request.max_nodes),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=GFAIDX_EXTRACTION_TIMEOUT_SECONDS,
            )

            return read_gfaidx_output(output_path)

    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="gfaidx extraction timed out") from exc
    except subprocess.CalledProcessError as exc:
        command_output = command_output_from_error(exc)
        if (
            "Start node was not found" in command_output
            or "Seed node was not found" in command_output
        ):
            # For early testing, surface gfaidx's own message directly so the
            # UI shows exactly what the command reported.
            raise HTTPException(status_code=404, detail=command_output) from exc

        raise HTTPException(
            status_code=500,
            detail=command_output or f"gfaidx failed with exit code {exc.returncode}",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/extract-region", response_class=PlainTextResponse)
def extract_region(request: RegionRequest) -> str:
    """Run gfaidx get_region and return the extracted GFA."""
    graph_entry = get_graph_entry(request.graph_id)
    sequence = request.sequence.strip()
    reference = request.reference.strip()

    if not sequence:
        raise HTTPException(status_code=400, detail="Region sequence is required")

    if request.end <= request.start:
        raise HTTPException(status_code=400, detail="Region end must be greater than start")

    ensure_gfaidx_binary()

    region = f"{sequence}:{request.start}-{request.end}"
    command = [
        str(GFAIDX_BINARY),
        "get_region",
        "--max_nodes",
        str(request.max_nodes),
    ]
    if reference:
        command.extend(["--reference", reference])

    try:
        with tempfile.TemporaryDirectory(prefix="gfaidx-region-") as tmp_dir:
            output_path = Path(tmp_dir) / "region.gfa"
            command.extend([str(graph_entry.path), region, str(output_path)])

            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=GFAIDX_EXTRACTION_TIMEOUT_SECONDS,
            )

            return read_gfaidx_output(output_path)

    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="gfaidx extraction timed out") from exc
    except subprocess.CalledProcessError as exc:
        command_output = command_output_from_error(exc)
        raise HTTPException(
            status_code=500,
            detail=command_output or f"gfaidx failed with exit code {exc.returncode}",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
