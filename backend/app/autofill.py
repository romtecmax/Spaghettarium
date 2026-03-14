"""
Generate a RhinoPython script that auto-fills empty Grasshopper input
parameters with placeholder geometry so the script runs immediately.

The generated script is saved to a temp file and executed inside Rhino
via -RunPythonScript after the .gh file loads.
"""

import tempfile
from pathlib import Path

# Log file location so we can debug
_LOG_FILE = str(Path(tempfile.gettempdir()) / "spaghettarium_autofill.log")

_AUTOFILL_SCRIPT = r'''
import System
import System.Drawing
import Rhino
import scriptcontext as sc
import time
import os
import traceback

LOG_PATH = r"''' + _LOG_FILE + r'''"

def log(msg):
    with open(LOG_PATH, "a") as f:
        f.write(msg + "\n")

def open_gh_file_and_wait(max_wait=30):
    """Open Grasshopper, load the GH file, and wait until it's ready."""
    log("Starting Grasshopper and opening file...")

    # GH_FILE is injected at the top of the script by the launcher
    gh_path = globals().get("GH_FILE", "")
    log("GH file: " + str(gh_path))

    # Step 1: Start Grasshopper plugin
    try:
        import Grasshopper as gh
        log("Grasshopper already available")
    except:
        log("Loading Grasshopper plugin...")
        Rhino.RhinoApp.RunScript("_Grasshopper", False)
        System.Threading.Thread.Sleep(3000)
        try:
            import Grasshopper as gh
            log("Grasshopper loaded")
        except Exception as e:
            log("FATAL: Cannot import Grasshopper: " + str(e))
            return None

    # Step 2: Ensure GH editor is visible, then open file
    if gh_path:
        log("Showing GH editor...")
        # Show the Grasshopper window
        Rhino.RhinoApp.RunScript("_Grasshopper", False)
        System.Threading.Thread.Sleep(2000)

        # Wait for editor to be available
        for attempt in range(20):
            try:
                editor = gh.Instances.DocumentEditor
                if editor is not None and editor.Visible:
                    log("GH editor visible")
                    break
            except:
                pass
            System.Threading.Thread.Sleep(500)

        # Open the file programmatically
        log("Opening GH file...")
        try:
            doc_io = gh.Kernel.GH_DocumentIO()
            if doc_io.Open(gh_path):
                doc = doc_io.Document
                gh.Instances.DocumentServer.AddDocument(doc)
                # Set as active document on the canvas
                try:
                    canvas = gh.Instances.ActiveCanvas
                    if canvas is not None:
                        canvas.Document = doc
                        canvas.Refresh()
                        log("Set as active document on canvas")
                except Exception as e:
                    log("Canvas set failed: " + str(e))
                doc.NewSolution(False)
                log("GH file opened and loaded")
            else:
                log("GH_DocumentIO.Open failed")
        except Exception as e:
            log("Open failed: " + str(e))

    # Step 3: Wait for the document to be ready
    for i in range(max_wait * 2):
        try:
            if gh.Instances.DocumentServer.DocumentCount > 0:
                doc = gh.Instances.DocumentServer[0]
                if doc is not None and doc.ObjectCount > 0:
                    log("GH document ready: {} objects".format(doc.ObjectCount))
                    return doc
        except:
            pass
        System.Threading.Thread.Sleep(500)

    log("TIMEOUT waiting for GH document")
    return None


def get_empty_input_params(ghdoc):
    """Find param objects that are inputs (no upstream wires) with no data."""
    import Grasshopper as gh
    empty = []
    for obj in ghdoc.Objects:
        param = None
        try:
            if hasattr(obj, "VolatileDataCount") and hasattr(obj, "Sources"):
                param = obj
        except:
            continue
        if param is None:
            continue

        try:
            if param.Sources and param.Sources.Count > 0:
                continue
        except:
            continue

        # Check if data is actually valid (not stale/null references)
        try:
            has_valid = False

            # Check volatile data for valid items
            if param.VolatileDataCount > 0:
                vdata = param.VolatileData
                for pi in range(vdata.PathCount):
                    branch = vdata.get_Branch(pi)
                    if branch:
                        for item in branch:
                            if item is not None and hasattr(item, "IsValid") and item.IsValid:
                                has_valid = True
                                break
                    if has_valid:
                        break

            # Check persistent data for valid items
            if not has_valid and hasattr(param, "PersistentDataCount") and param.PersistentDataCount > 0:
                pdata = param.PersistentData
                for pi in range(pdata.PathCount):
                    branch = pdata.get_Branch(pi)
                    if branch:
                        for item in branch:
                            if item is not None and hasattr(item, "IsValid") and item.IsValid:
                                has_valid = True
                                break
                    if has_valid:
                        break

            if has_valid:
                continue
        except:
            continue

        empty.append(param)
    return empty


def classify_param(param):
    """Return a canonical type key using type name + nickname fallback."""
    type_name = param.GetType().Name

    TYPE_MAP = {
        "Param_Point": "point", "Param_Pt": "point",
        "Param_Curve": "curve", "Param_Crv": "curve",
        "Param_Surface": "surface", "Param_Srf": "surface",
        "Param_Brep": "brep",
        "Param_Geometry": "brep",
        "Param_Mesh": "mesh",
        "Param_Plane": "plane", "Param_Pln": "plane",
        "Param_Vector": "vector", "Param_Vec": "vector",
        "Param_Line": "line", "Param_Ln": "line",
        "Param_Circle": "circle",
        "Param_Rectangle": "rectangle",
        "Param_Number": "number", "Param_Double": "number",
        "Param_Integer": "integer", "Param_Int": "integer",
        "Param_Boolean": "boolean", "Param_Bool": "boolean",
        "Param_String": "string", "Param_Str": "string",
        "Param_Colour": "colour", "Param_Color": "colour",
        "Param_Interval": "interval",
        "Param_Interval2D": "interval2d",
        "Param_GenericObject": "point",
        "Param_Arc": "curve",
    }
    if type_name in TYPE_MAP:
        return TYPE_MAP[type_name]

    nickname = ""
    try:
        nickname = (getattr(param, "NickName", "") or "").strip().lower()
    except:
        pass
    name = ""
    try:
        name = (getattr(param, "Name", "") or "").strip().lower()
    except:
        pass
    label = nickname or name

    NAME_MAP = {
        "surface": "surface", "srf": "surface",
        "brep": "brep", "solid": "brep", "geometry": "brep", "geo": "brep",
        "curve": "curve", "crv": "curve", "polyline": "curve",
        "mesh": "mesh",
        "point": "point", "pt": "point",
        "plane": "plane", "pln": "plane",
        "vector": "vector", "vec": "vector",
        "line": "line", "ln": "line",
        "circle": "circle",
        "rectangle": "rectangle", "rec": "rectangle",
        "number": "number", "num": "number",
        "integer": "integer", "int": "integer",
        "boolean": "boolean", "bool": "boolean", "toggle": "boolean",
        "string": "string", "str": "string", "text": "string",
        "colour": "colour", "color": "colour",
    }
    if label in NAME_MAP:
        return NAME_MAP[label]

    return None


def add_geo_to_rhino(geometry):
    """Add geometry to Rhino doc, return GUID."""
    sc.doc = Rhino.RhinoDoc.ActiveDoc
    guid = sc.doc.Objects.Add(geometry)
    sc.doc.Views.Redraw()
    return guid


def fill_param(param, kind):
    """Fill a single param with default data. Returns True on success."""
    import Grasshopper as gh
    path = gh.Kernel.Data.GH_Path(0)

    # ---- Geometry types: add to Rhino doc, then reference via persistent data ----
    if kind == "surface":
        srf = Rhino.Geometry.NurbsSurface.CreateFromCorners(
            Rhino.Geometry.Point3d(-10, -10, 0),
            Rhino.Geometry.Point3d(10, -10, 0),
            Rhino.Geometry.Point3d(10, 10, 0),
            Rhino.Geometry.Point3d(-10, 10, 0))
        guid = add_geo_to_rhino(srf)
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Surface()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    elif kind == "curve":
        crv = Rhino.Geometry.Circle(Rhino.Geometry.Plane.WorldXY, 10.0).ToNurbsCurve()
        guid = add_geo_to_rhino(crv)
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Curve()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    elif kind == "brep":
        box = Rhino.Geometry.Box(
            Rhino.Geometry.Plane.WorldXY,
            Rhino.Geometry.Interval(0, 10),
            Rhino.Geometry.Interval(0, 10),
            Rhino.Geometry.Interval(0, 10))
        guid = add_geo_to_rhino(box.ToBrep())
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Brep()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    elif kind == "mesh":
        box = Rhino.Geometry.Box(
            Rhino.Geometry.Plane.WorldXY,
            Rhino.Geometry.Interval(0, 10),
            Rhino.Geometry.Interval(0, 10),
            Rhino.Geometry.Interval(0, 10))
        mesh = Rhino.Geometry.Mesh.CreateFromBox(box, 2, 2, 2)
        guid = add_geo_to_rhino(mesh)
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Mesh()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    elif kind == "point":
        pt = Rhino.Geometry.Point3d(0, 0, 0)
        guid = add_geo_to_rhino(Rhino.Geometry.Point(pt))
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Point()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    elif kind == "line":
        ln = Rhino.Geometry.LineCurve(
            Rhino.Geometry.Point3d(0, 0, 0),
            Rhino.Geometry.Point3d(10, 0, 0))
        guid = add_geo_to_rhino(ln)
        if guid != System.Guid.Empty:
            wrapper = gh.Kernel.Types.GH_Curve()
            wrapper.CastFrom(Rhino.DocObjects.ObjRef(guid))
            param.PersistentData.Clear()
            param.PersistentData.Append(wrapper, path)
            param.ExpireSolution(False)
            return True

    # ---- Value types: inject as volatile data directly ----
    elif kind == "plane":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Plane(Rhino.Geometry.Plane.WorldXY))
        return True

    elif kind == "vector":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Vector(Rhino.Geometry.Vector3d(0, 0, 1)))
        return True

    elif kind == "number":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Number(5.0))
        return True

    elif kind == "integer":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Integer(5))
        return True

    elif kind == "boolean":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Boolean(True))
        return True

    elif kind == "string":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_String("Hello"))
        return True

    elif kind == "colour":
        param.AddVolatileData(path, 0, gh.Kernel.Types.GH_Colour(System.Drawing.Color.DodgerBlue))
        return True

    elif kind == "interval":
        param.AddVolatileData(path, 0,
            gh.Kernel.Types.GH_Interval(Rhino.Geometry.Interval(0, 10)))
        return True

    return False


def autofill():
    """Main entry point."""
    # Clear log
    with open(LOG_PATH, "w") as f:
        f.write("=== Spaghettarium Autofill ===\n")

    try:
        ghdoc = open_gh_file_and_wait()
        if ghdoc is None:
            log("No GH document found, exiting")
            return

        System.Threading.Thread.Sleep(2000)
        log("Scanning for empty input params...")

        empty_params = get_empty_input_params(ghdoc)
        log("Found {} empty input params".format(len(empty_params)))

        if not empty_params:
            log("Nothing to fill")
            return

        filled = 0
        for param in empty_params:
            type_name = param.GetType().Name
            nickname = getattr(param, "NickName", "?")
            log("  Checking: {} (type={})".format(nickname, type_name))

            skip_types = ("GH_Group", "GH_Scribble", "GH_Sketch",
                          "GH_NumberSlider", "GH_BooleanToggle")
            if type_name in skip_types:
                log("    -> skipped (UI element)")
                continue

            kind = classify_param(param)
            # Log full type hierarchy for debugging
            full_type = param.GetType().FullName
            bases = []
            t = param.GetType().BaseType
            while t is not None:
                bases.append(t.Name)
                t = t.BaseType
            log("  Param: {} (type={}, fulltype={}, bases={}, kind={})".format(
                nickname, type_name, full_type, "->".join(bases), kind))

            if kind is None:
                log("    -> skipped (unknown type)")
                continue

            try:
                ok = fill_param(param, kind)
                if ok:
                    log("    -> FILLED")
                    filled += 1
                else:
                    log("    -> failed to fill")
            except Exception as e:
                log("    -> ERROR: " + traceback.format_exc())

        log("Filled {} params".format(filled))

        if filled > 0:
            ghdoc.NewSolution(True)
            log("Solution recomputed")
            Rhino.RhinoApp.RunScript("_ZoomExtents", False)

    except Exception as e:
        log("FATAL: " + traceback.format_exc())

autofill()
'''


def generate_autofill_script() -> Path:
    """Write the autofill script to a temp file and return the path."""
    script_path = Path(tempfile.gettempdir()) / "spaghettarium_autofill.py"
    script_path.write_text(_AUTOFILL_SCRIPT, encoding="utf-8")
    return script_path
