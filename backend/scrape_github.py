"""
Grasshopper Script Downloader (No Token Required)
==================================================
Clones public GitHub repos and collects all .gh / .ghx files into a
local folder. No API token needed — uses git clone on public repos.

Usage:
    python scrape_github.py                # clone repos + collect files
    python scrape_github.py --skip-clone   # re-scan already-cloned repos

Output:
    data/scraped/gh_files/   — all collected .gh/.ghx files (flat folder)
    data/scraped/repos/      — cloned repo cache
    data/scraped/manifest.json — index of all collected files with metadata
"""

import sys
import json
import shutil
import logging
import subprocess
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

SKIP_CLONE = "--skip-clone" in sys.argv

# Where to store everything
DATA_DIR = Path("data/scraped")
REPOS_DIR = DATA_DIR / "repos"
OUTPUT_DIR = DATA_DIR / "gh_files"
DATA_DIR.mkdir(parents=True, exist_ok=True)
REPOS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Curated list of public GitHub repos containing Grasshopper files.
# Add more repos here to expand the dataset.
# ---------------------------------------------------------------------------
KNOWN_REPOS = [
    # === User scripts / definitions / how-tos ===
    "jhorikawa/GrasshopperHowtos",               # YouTube tutorial GH files (parametric design book)
    "jhorikawa/GrasshopperProgrammingTutorials",  # programming tutorial GH files
    "fraguada/Grasshopper-Tools",                 # collection of GH definitions, user objects, scripts
    "dantaeyoung/GrasshopperChallenges",          # learning challenges with .ghx solutions
    "dantaeyoung/GrasshopperArsenal",             # shared GH components and examples
    "ustajan/grasshopper",                        # user GH definitions
    "jmuozan/AI_3D_Models_Grasshopper",           # AI tools for GH with example files

    # === Workshops / courses (real definitions used in teaching) ===
    "Co-de-iT/DesignByData_ACD2021",
    "Co-de-iT/DesignByData",
    "Co-de-iT/DesignByData_ATA2020",             # agent-based tectonics workshop
    "Co-de-iT/GH2RHP",                           # GH definition to Rhino plugin
    "EPFL-GC/gc-class",                           # EPFL geometry & computation course
    "parametriccamp/grasshopper-intro",           # parametric camp intro
    "computational-design-Ede/Grasshopper-Intro",

    # === Architecture / pavilion / fabrication projects ===
    "GeneKao/Pavilion2015_ITECH",                 # ITECH pavilion workflow
    "lrao01-su/parametric-facade-gh_tool",        # parametric facade paneling
    "j-deering/Anisotropic-Implants-by-Voronoi-Tessellation",  # voronoi implant design
    "hat600/GHpy-voronois",                       # voronoi diagrams
    "architecture-building-systems/ASF_Simulation", # building simulation
    "architecture-building-systems/cea-grasshopper", # city energy analyst
    "fellesverkstedet/Bark-beetle-parametric-toolpaths", # CNC/3D print/laser fabrication
    "Digital-Structures/gh-design-space-exploration",    # MIT design space exploration / MOO

    # === Plugin example files (contain user-facing .gh definitions) ===
    "mcneel/rhino-developer-samples",
    "mcneel/rhino.inside-revit",
    "visose/Robots",                              # robotic fabrication examples
    "petrasvestartas/NGon",                       # mesh examples
    "arendvw/clipper",                            # polygon clipping examples
    "enmerk4r/Swiftlet",                          # HTTP/API examples
    "specklesystems/speckle-sharp",               # Speckle interop examples
    "tsvilans/tas",                               # timber assembly
    "DanielAbalde/Leopard",
    "garciadelcastillo/BRobot-for-Grasshopper",   # robotic control
    "philipbelesky/groundhog",                    # landscape architecture
    "cityjson/RhinoCityJSON",                     # CityJSON / urban
    "SOFiSTiK/gh_sofistik",                       # structural analysis
    "mikity-toshihiko/Crane",                     # origami simulation
    "formateng/giraffe",                          # planar meshing

    # === Environmental analysis ===
    "ladybug-tools/ladybug-grasshopper",
    "ladybug-tools/honeybee-grasshopper-core",
    "ladybug-tools/dragonfly-grasshopper",
    "ladybug-tools/butterfly-grasshopper",

    # === Community user scripts ===
    "provolot/GrasshopperExamples",
    "kaushik-ls/Grasshopper-Scripts",
    "mathiasjepsen/grasshopper-scripts",
    "digitalcircuit/rhino-grasshopper",
    "mwickerson/GH_Demos",
    "archiDECODE/Examples",
    "saeranv/Compass",
    "dongwoosuk/rhino-grasshopper-mcp",           # AI + GH integration
    "Torakon/BESO-for-grasshopper",               # structural optimization
    "DesignReform/SandWorm",                       # landscape simulation
]


def clone_repo(repo_full_name: str) -> Path | None:
    """Shallow-clone a public GitHub repo. Returns local path or None."""
    local_dir = REPOS_DIR / repo_full_name.replace("/", "_")
    if local_dir.exists():
        log.info(f"  Already cloned: {repo_full_name}")
        return local_dir

    url = f"https://github.com/{repo_full_name}.git"
    log.info(f"  Cloning {repo_full_name} ...")
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", url, str(local_dir)],
            capture_output=True, text=True, timeout=120,
        )
        if local_dir.exists():
            return local_dir
        else:
            log.warning(f"  Clone failed: {result.stderr.strip()[:100]}")
    except subprocess.TimeoutExpired:
        log.warning(f"  Clone timed out: {repo_full_name}")
        if local_dir.exists():
            shutil.rmtree(local_dir, ignore_errors=True)
    except FileNotFoundError:
        log.error("git is not installed or not in PATH")
        sys.exit(1)
    return None


def find_gh_files(directory: Path) -> list[Path]:
    """Find all .gh and .ghx files (actual files, not directories)."""
    files = []
    for f in directory.rglob("*"):
        if f.is_file() and f.suffix.lower() in (".gh", ".ghx"):
            files.append(f)
    return files


def main():
    log.info("=" * 60)
    log.info("Grasshopper Script Downloader")
    log.info(f"Repos to scan: {len(KNOWN_REPOS)}")
    log.info(f"Output: {OUTPUT_DIR.resolve()}")
    log.info("=" * 60)

    # Step 1: Clone repos
    log.info("\n--- Step 1: Cloning repos ---")
    cloned = []
    for repo in KNOWN_REPOS:
        if SKIP_CLONE:
            local_dir = REPOS_DIR / repo.replace("/", "_")
            if local_dir.exists():
                cloned.append((repo, local_dir))
        else:
            local_dir = clone_repo(repo)
            if local_dir:
                cloned.append((repo, local_dir))

    log.info(f"\nCloned/found {len(cloned)} / {len(KNOWN_REPOS)} repos")

    # Step 2: Find and copy .gh/.ghx files
    log.info("\n--- Step 2: Collecting .gh/.ghx files ---")
    manifest = []
    seen_names = {}  # handle duplicate filenames

    for repo, local_dir in cloned:
        gh_files = find_gh_files(local_dir)
        if gh_files:
            log.info(f"  {repo}: {len(gh_files)} files")

        for f in gh_files:
            rel_path = f.relative_to(local_dir)
            base_name = f.name

            # Handle duplicate filenames by prepending repo name
            if base_name in seen_names:
                seen_names[base_name] += 1
                stem = f.stem
                suffix = f.suffix
                base_name = f"{repo.replace('/', '_')}_{stem}{suffix}"
            else:
                seen_names[base_name] = 1

            dest = OUTPUT_DIR / base_name
            if not dest.exists():
                shutil.copy2(f, dest)

            manifest.append({
                "filename": base_name,
                "repo": repo,
                "path": str(rel_path).replace("\\", "/"),
                "size_bytes": f.stat().st_size,
                "extension": f.suffix.lower(),
                "github_url": f"https://github.com/{repo}/blob/HEAD/{str(rel_path).replace(chr(92), '/')}",
            })

    # Save manifest
    manifest_path = DATA_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    # Stats
    ghx_count = sum(1 for m in manifest if m["extension"] == ".ghx")
    gh_count = sum(1 for m in manifest if m["extension"] == ".gh")
    total_size = sum(m["size_bytes"] for m in manifest)
    unique_repos = len(set(m["repo"] for m in manifest))

    log.info("\n" + "=" * 60)
    log.info(f"DONE! Collected {len(manifest)} Grasshopper scripts")
    log.info(f"  .ghx files: {ghx_count}")
    log.info(f"  .gh files:  {gh_count}")
    log.info(f"  From {unique_repos} repos")
    log.info(f"  Total size: {total_size / 1024 / 1024:.1f} MB")
    log.info(f"  Files saved to: {OUTPUT_DIR.resolve()}")
    log.info(f"  Manifest: {manifest_path.resolve()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
