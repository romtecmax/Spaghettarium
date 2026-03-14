"""
Launcher: installs Yak packages and opens a Grasshopper definition in Rhino.

Runs directly on the server (which is the user's local machine).
"""

import logging
import os
import shutil
import subprocess
from pathlib import Path

from .autofill import generate_autofill_script

log = logging.getLogger(__name__)


def _inject_gh_path(autofill_script: Path, gh_file_path: str):
    """Prepend a GH_FILE variable to the autofill script."""
    content = autofill_script.read_text(encoding="utf-8")
    # Replace the placeholder at the top
    content = f'GH_FILE = r"{gh_file_path}"\n' + content
    autofill_script.write_text(content, encoding="utf-8")

# Standard Rhino install locations (checked in order)
_RHINO_PATHS = [
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Rhino 8", "System"),
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Rhino 7", "System"),
]


def _find_exe(name: str) -> Path | None:
    """Find an executable in standard Rhino install directories."""
    for d in _RHINO_PATHS:
        p = Path(d) / name
        if p.is_file():
            return p
    return None


def launch_in_grasshopper(
    gh_file: Path,
    plugins: list[dict],
    yak_mapping: dict[str, dict],
) -> dict:
    """Install required Yak packages and open a .gh file in Rhino.

    Returns a status dict with details about what happened.
    """
    rhino_exe = _find_exe("Rhino.exe")
    yak_exe = _find_exe("Yak.exe")

    steps: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []

    if not rhino_exe:
        return {
            "success": False,
            "error": "Rhino not found. Install Rhino 7 or 8.",
            "steps": [],
            "warnings": [],
        }

    steps.append(f"Found Rhino: {rhino_exe}")

    # --- Install Yak packages ---
    if yak_exe:
        steps.append(f"Found Yak: {yak_exe}")
        for p in plugins:
            pid = p.get("pluginId", "")
            name = p.get("name", "unknown")
            mapping = yak_mapping.get(pid)

            # Skip plugins known to be bundled or explicitly unavailable
            if mapping and not mapping.get("yakAvailable") and mapping.get("notes"):
                notes = mapping["notes"]
                if "bundled" in notes.lower() or "no separate install" in notes.lower():
                    steps.append(f"{name}: bundled with Rhino, skipping")
                    continue

            # Determine package name: use manual mapping if available, otherwise try plugin name
            pkg = None
            if mapping and mapping.get("yakAvailable") and mapping.get("yakPackage"):
                pkg = mapping["yakPackage"]
            elif mapping and mapping.get("yakPackage"):
                pkg = mapping["yakPackage"]
            else:
                pkg = name  # best-effort: try the plugin name directly

            try:
                result = subprocess.run(
                    [str(yak_exe), "install", pkg],
                    capture_output=True, text=True, timeout=60,
                )
                out = (result.stdout + result.stderr).strip()
                if result.returncode == 0:
                    steps.append(f"Installed {pkg} via Yak")
                elif "already installed" in out.lower() or "up to date" in out.lower():
                    steps.append(f"{pkg} already installed")
                elif "no package found" in out.lower() or "not found" in out.lower():
                    warnings.append(f"'{name}' not found on Yak — may need manual install from food4rhino.com")
                else:
                    warnings.append(f"Yak install {pkg}: {out[:200]}")
            except subprocess.TimeoutExpired:
                warnings.append(f"Yak install {pkg} timed out")
            except Exception as e:
                warnings.append(f"Yak install {pkg} failed: {e}")
    else:
        warnings.append("Yak.exe not found — skipping plugin installation")

    # --- Generate autofill script ---
    try:
        autofill_path = generate_autofill_script()
        steps.append("Generated autofill script for empty inputs")
    except Exception as e:
        autofill_path = None
        warnings.append(f"Could not generate autofill script: {e}")

    # --- Open in Rhino/Grasshopper ---
    try:
        if autofill_path:
            # Inject the GH file path into the autofill script so it can open it itself
            _inject_gh_path(autofill_path, str(gh_file))

            import tempfile
            bat_path = Path(tempfile.gettempdir()) / "spaghettarium_launch.bat"
            bat_content = (
                f'@echo off\r\n'
                f'start "" "{rhino_exe}" '
                f'/nosplash '
                f'/runscript="_-RunPythonScript ""{autofill_path}"""\r\n'
            )
            bat_path.write_text(bat_content, encoding="utf-8")
            subprocess.Popen([str(bat_path)], shell=True)
            steps.append(f"Opened {gh_file.name} in Rhino with auto-fill enabled")
        else:
            subprocess.Popen(
                [str(rhino_exe), str(gh_file)],
            )
            steps.append(f"Opened {gh_file.name} in Rhino")
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to launch Rhino: {e}",
            "steps": steps,
            "warnings": warnings,
        }

    return {
        "success": True,
        "steps": steps,
        "warnings": warnings,
    }
