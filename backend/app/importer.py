"""
Import pipeline: receive uploaded .gh/.ghx files, import into Neo4j via
SdGraphDbCli, enrich with AI, and generate embeddings.
"""

import os
import subprocess
import logging
import threading
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
UPLOAD_DIR = Path(os.environ.get(
    "IMPORT_UPLOAD_DIR",
    Path(__file__).resolve().parent.parent / "data" / "uploads",
))
CLI_DLL = Path(os.environ.get(
    "SDGRAPHDBCLI_DLL",
    Path(__file__).resolve().parent.parent.parent / "SdGraphDbCli" / "SdGraphDbCli.dll",
))
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")


class JobStatus(str, Enum):
    idle = "idle"
    importing = "importing"
    enriching = "enriching"
    embedding = "embedding"
    done = "done"
    error = "error"


@dataclass
class ImportJob:
    status: JobStatus = JobStatus.idle
    file_names: list[str] = field(default_factory=list)
    progress: str = ""
    files_total: int = 0
    files_imported: int = 0
    files_failed: int = 0
    error: str | None = None
    log_lines: list[str] = field(default_factory=list)

    def log(self, msg: str):
        log.info(msg)
        self.log_lines.append(msg)
        if len(self.log_lines) > 200:
            self.log_lines = self.log_lines[-200:]

    def to_dict(self):
        return {
            "status": self.status.value,
            "file_names": self.file_names,
            "progress": self.progress,
            "files_total": self.files_total,
            "files_imported": self.files_imported,
            "files_failed": self.files_failed,
            "error": self.error,
            "log": self.log_lines[-50:],
        }


# Global singleton job
_current_job = ImportJob()
_lock = threading.Lock()


def get_job() -> ImportJob:
    return _current_job


def reset_job():
    global _current_job
    _current_job = ImportJob()
    return _current_job


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def _import_files(job: ImportJob, files: list[Path]):
    """Import .gh/.ghx files into Neo4j via SdGraphDbCli."""
    succeeded = 0
    failed = 0

    for i, filepath in enumerate(files):
        job.progress = f"Importing {i+1}/{len(files)}: {filepath.name}"
        job.log(f"[{i+1}/{len(files)}] Importing {filepath.name}")
        try:
            result = subprocess.run(
                ["dotnet", str(CLI_DLL), "import", "--path", str(filepath)],
                capture_output=True, text=True, timeout=60,
                env={**os.environ, "NEO4J_USER": NEO4J_USER, "NEO4J_PASSWORD": NEO4J_PASSWORD},
            )
            if result.returncode != 0 or "Error" in result.stdout or "Error" in result.stderr:
                error_msg = result.stderr or result.stdout
                job.log(f"  FAILED: {error_msg.strip()[:200]}")
                failed += 1
            else:
                succeeded += 1
                job.log(f"  OK")
        except subprocess.TimeoutExpired:
            job.log(f"  TIMEOUT")
            failed += 1
        except Exception as e:
            job.log(f"  ERROR: {e}")
            failed += 1

    job.files_imported = succeeded
    job.files_failed = failed


def _run_enrichment(job: ImportJob):
    """Run the enrichment script as a subprocess."""
    backend_dir = Path(__file__).resolve().parent.parent
    try:
        result = subprocess.run(
            ["python", str(backend_dir / "enrich_graph.py")],
            capture_output=True, text=True, timeout=600,
            cwd=str(backend_dir),
        )
        for line in result.stdout.splitlines()[-20:]:
            job.log(f"  enrich: {line}")
        if result.returncode != 0:
            job.log(f"  Enrichment stderr: {result.stderr.strip()[:500]}")
    except Exception as e:
        job.log(f"  Enrichment error: {e}")


def _run_embeddings(job: ImportJob):
    """Run the embedding generation script as a subprocess."""
    backend_dir = Path(__file__).resolve().parent.parent
    try:
        result = subprocess.run(
            ["python", str(backend_dir / "generate_embeddings.py")],
            capture_output=True, text=True, timeout=300,
            cwd=str(backend_dir),
        )
        for line in result.stdout.splitlines()[-10:]:
            job.log(f"  embed: {line}")
        if result.returncode != 0:
            job.log(f"  Embedding stderr: {result.stderr.strip()[:500]}")
    except Exception as e:
        job.log(f"  Embedding error: {e}")


# ---------------------------------------------------------------------------
# Full pipeline (runs in background thread)
# ---------------------------------------------------------------------------

def run_pipeline(files: list[Path]):
    """Run the full import pipeline for the given files."""
    job = get_job()
    job.file_names = [f.name for f in files]
    job.files_total = len(files)

    try:
        # Step 1: Import into Neo4j
        job.status = JobStatus.importing
        job.log(f"Starting import for {len(files)} files")
        _import_files(job, files)
        job.log(f"Import: {job.files_imported} succeeded, {job.files_failed} failed")

        if job.files_imported == 0:
            job.status = JobStatus.done
            job.progress = "No files imported successfully"
            return

        # Step 2: Enrich
        job.status = JobStatus.enriching
        job.progress = "Running AI enrichment..."
        job.log("Starting enrichment...")
        _run_enrichment(job)

        # Step 3: Embeddings
        job.status = JobStatus.embedding
        job.progress = "Generating embeddings..."
        job.log("Generating embeddings...")
        _run_embeddings(job)

        job.status = JobStatus.done
        job.progress = "Import complete!"
        job.log("Pipeline finished successfully")

    except Exception as e:
        job.status = JobStatus.error
        job.error = str(e)
        job.log(f"Pipeline error: {e}")


def start_pipeline(files: list[Path]):
    """Start the pipeline in a background thread."""
    with _lock:
        job = get_job()
        if job.status not in (JobStatus.idle, JobStatus.done, JobStatus.error):
            raise RuntimeError("A pipeline is already running")
        reset_job()

    thread = threading.Thread(target=run_pipeline, args=(files,), daemon=True)
    thread.start()
