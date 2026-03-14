"""
Import .gh scripts one by one using SdGraphDbCli, skipping files that fail.
Then run enrichment and generate embeddings for the new nodes.
"""

import os
import subprocess
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

GH_SCRIPTS_DIR = r"C:\Reope\GitHub\neo4j-grasshopper-graph\data\scraped\gh_scripts"
CLI_DLL = r"C:\Reope\GitHub\neo4j-grasshopper-graph\SdGraphDbCli\SdGraphDbCli\SdGraphDbCli.dll"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "neo4jtest123"


def import_files():
    files = sorted(
        f for f in os.listdir(GH_SCRIPTS_DIR)
        if f.lower().endswith((".gh", ".ghx"))
    )
    log.info(f"Found {len(files)} Grasshopper files to import")

    succeeded = []
    failed = []

    for i, filename in enumerate(files):
        filepath = os.path.join(GH_SCRIPTS_DIR, filename)
        log.info(f"[{i+1}/{len(files)}] Importing: {filename}")

        try:
            result = subprocess.run(
                ["dotnet", CLI_DLL, "import", "--path", filepath],
                capture_output=True,
                text=True,
                timeout=60,
                env={**os.environ, "NEO4J_USER": NEO4J_USER, "NEO4J_PASSWORD": NEO4J_PASSWORD},
            )
            if result.returncode != 0 or "Error" in result.stdout or "Error" in result.stderr:
                error_msg = result.stderr or result.stdout
                log.warning(f"  FAILED: {error_msg.strip()[:200]}")
                failed.append(filename)
            else:
                succeeded.append(filename)
        except subprocess.TimeoutExpired:
            log.warning(f"  TIMEOUT: {filename}")
            failed.append(filename)
        except Exception as e:
            log.warning(f"  ERROR: {filename}: {e}")
            failed.append(filename)

    log.info(f"\nImport complete: {len(succeeded)} succeeded, {len(failed)} failed")
    if failed:
        log.info(f"Failed files:")
        for f in failed:
            log.info(f"  - {f}")

    return succeeded, failed


if __name__ == "__main__":
    import_files()
