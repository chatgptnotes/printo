"""
CAD → raster conversion for the drawing-extraction pipeline.

Construction engineers work in native CAD files (DWG/DXF/DWF), but the extraction
pipeline is raster-based (Claude Vision over a rendered image). This module renders
a CAD drawing to a high-resolution PNG and hands that to the existing
preprocess → prepass → extract path.

Strategy (each step degrades instead of raising):
    .dxf  → parse + render with ezdxf using its PyMuPDF backend (pure Python;
            PyMuPDF is already a dependency, so no matplotlib is pulled in).
    .dwg  → convert to DXF via an external converter (LibreDWG `dwg2dxf` or the
            ODA File Converter), then render the DXF.
    .dwf  → best-effort: DWFx packages are OPC/zip containers that often embed a
            raster sheet/preview — extract the largest one. Otherwise unsupported.

When a required dependency or converter is missing, or the file is malformed,
`convert_to_png` returns `ConversionResult(ok=False, reason=<user-facing message>)`
so the caller can show a clear "export to PDF/DXF" error rather than crashing.

The rendered PNG is cached next to the source as `<stem>.cadrender.png`, so the
upload pipeline and later report regeneration share one conversion.

Optional environment overrides:
    DWG2DXF_PATH         absolute path to LibreDWG's `dwg2dxf`
    ODA_CONVERTER_PATH   absolute path to `ODAFileConverter` (on Linux, point this
                         at an `xvfb-run ODAFileConverter` wrapper for headless use)
    CAD_RENDER_DPI       render resolution (default 200, clamped to 72..400)
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

try:
    import ezdxf
    from ezdxf import recover
    from ezdxf.addons.drawing import Frontend, RenderContext, layout
    from ezdxf.addons.drawing.pymupdf import PyMuPdfBackend
    _HAS_EZDXF = True
except Exception:                       # pragma: no cover - env dependent
    _HAS_EZDXF = False


CAD_SUFFIXES = {".dwg", ".dxf", ".dwf"}
RENDER_SUFFIX = ".cadrender.png"        # deterministic cache name next to the source

_MIN_DPI, _MAX_DPI = 72, 400


def _env_dpi(default: int = 200) -> int:
    """Read CAD_RENDER_DPI defensively — a bad value must never break import."""
    try:
        return int(os.getenv("CAD_RENDER_DPI", str(default)) or default)
    except (TypeError, ValueError):
        return default


_DEFAULT_DPI = _env_dpi()
_CONVERT_TIMEOUT = 180                   # seconds for the external DWG converter
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_MIN_EMBEDDED_PREVIEW = 4096             # ignore tiny DWF icons/thumbnails (bytes)

# ── user-facing messages (shown verbatim in the pipeline error stream) ──────────
_MSG_NO_EZDXF = (
    "CAD support isn't installed on the server (ezdxf missing). "
    "Please upload a PDF or image export of the drawing instead.")
_MSG_DWG_NO_CONVERTER = (
    "Couldn't read this DWG — a CAD converter (ODA File Converter or LibreDWG) "
    "isn't available on the server. Please export the drawing to PDF or DXF and "
    "upload that instead.")
_MSG_DWF_UNSUPPORTED = (
    "Couldn't generate a preview for this DWF. Please export the drawing to PDF "
    "or DXF and upload that instead.")
_MSG_BAD_FILE = (
    "Couldn't parse this {ext} file — it may be corrupt or an unsupported "
    "version. Please re-export to PDF or DXF and try again.")


@dataclass(frozen=True)
class ConversionResult:
    """Outcome of a CAD→PNG conversion.

    ok=True  → png_path points at a readable PNG.
    ok=False → reason holds a clear, user-facing message.
    """
    ok: bool
    png_path: str | None = None
    reason: str | None = None
    converter: str | None = None              # 'ezdxf' | 'libredwg' | 'oda' | 'dwf-preview' | 'cache'
    text_hints: tuple[str, ...] = field(default_factory=tuple)


def is_cad(path_or_suffix: str) -> bool:
    """True if the path/filename/suffix refers to a supported CAD format."""
    s = (path_or_suffix or "").lower()
    if not s.startswith("."):
        s = Path(s).suffix.lower()
    return s in CAD_SUFFIXES


def _clamp_dpi(dpi: int) -> int:
    return max(_MIN_DPI, min(int(dpi), _MAX_DPI))


# ── DXF parse + render (the common rendering core) ──────────────────────────────
def _read_dxf(dxf_path: Path):
    """Load a DXF document robustly. Returns the document or None on failure."""
    try:
        doc, _auditor = recover.readfile(str(dxf_path))   # tolerant of minor damage
        return doc
    except Exception:
        try:
            return ezdxf.readfile(str(dxf_path))
        except Exception:
            return None


def _extract_text_entities(msp, limit: int = 200) -> tuple[str, ...]:
    """Best-effort: pull TEXT/MTEXT strings (e.g. title-block labels) for hints."""
    out: list[str] = []
    try:
        for e in msp:
            kind = e.dxftype()
            if kind == "TEXT":
                txt = (e.dxf.text or "").strip()
            elif kind == "MTEXT":
                txt = (e.text or "").strip() if hasattr(e, "text") else ""
            else:
                continue
            if txt:
                out.append(txt)
            if len(out) >= limit:
                break
    except Exception:
        pass
    return tuple(out)


def _render_dxf(dxf_path: Path, out_png: Path, dpi: int) -> tuple[bool, tuple[str, ...]]:
    """Render a DXF modelspace to a PNG file. Returns (ok, text_hints)."""
    if not _HAS_EZDXF:
        return False, ()
    doc = _read_dxf(dxf_path)
    if doc is None:
        return False, ()
    try:
        msp = doc.modelspace()
        hints = _extract_text_entities(msp)
        backend = PyMuPdfBackend()
        Frontend(RenderContext(doc), backend).draw_layout(msp)
        # Page(0, 0) → auto-size to the drawing extents; small margin for legibility.
        page = layout.Page(0, 0, layout.Units.mm, margins=layout.Margins.all(5))
        png = backend.get_pixmap_bytes(page, fmt="png", dpi=_clamp_dpi(dpi))
        if not png or png[:8] != _PNG_MAGIC:
            return False, hints
        out_png.write_bytes(png)
        ok = out_png.exists() and out_png.stat().st_size > 0
        return ok, hints
    except Exception:
        return False, ()


# ── DWG → DXF (external converter) ──────────────────────────────────────────────
def _find_converter() -> tuple[str, str] | None:
    """Locate a DWG→DXF converter. Returns ('libredwg'|'oda', exe_path) or None."""
    env_dwg2dxf = os.getenv("DWG2DXF_PATH")
    if env_dwg2dxf and Path(env_dwg2dxf).exists():
        return ("libredwg", env_dwg2dxf)
    env_oda = os.getenv("ODA_CONVERTER_PATH")
    if env_oda and Path(env_oda).exists():
        return ("oda", env_oda)
    for name in ("dwg2dxf", "dwg2dxf.exe"):
        found = shutil.which(name)
        if found:
            return ("libredwg", found)
    for name in ("ODAFileConverter", "ODAFileConverter.exe"):
        found = shutil.which(name)
        if found:
            return ("oda", found)
    return None


def _dwg_to_dxf(dwg_path: Path, out_dir: Path) -> tuple[Path | None, str | None]:
    """Convert DWG→DXF. Returns (dxf_path|None, kind|None).

    kind is None ONLY when no converter exists (distinct from a conversion that
    ran but failed) so the caller can show the right message.
    """
    conv = _find_converter()
    if conv is None:
        return None, None
    kind, exe = conv
    try:
        if kind == "libredwg":
            dxf_path = out_dir / (dwg_path.stem + ".dxf")
            subprocess.run(
                [exe, "-o", str(dxf_path), str(dwg_path)],
                check=True, capture_output=True, timeout=_CONVERT_TIMEOUT,
            )
        else:
            # ODA File Converter is directory-batch based:
            #   ODAFileConverter <in_dir> <out_dir> <out_ver> <out_type> <recurse> <audit> [filter]
            subprocess.run(
                [exe, str(dwg_path.parent), str(out_dir),
                 "ACAD2018", "DXF", "0", "1", dwg_path.name],
                check=True, capture_output=True, timeout=_CONVERT_TIMEOUT,
            )
            dxf_path = out_dir / (dwg_path.stem + ".dxf")
        if dxf_path.exists() and dxf_path.stat().st_size > 0:
            return dxf_path, kind
        return None, kind
    except Exception:
        return None, kind


# ── DWF best-effort preview extraction ──────────────────────────────────────────
def _dwf_extract_preview(dwf_path: Path, out_png: Path) -> bool:
    """DWFx is an OPC/zip package; extract the largest embedded raster as a preview."""
    try:
        if not zipfile.is_zipfile(dwf_path):
            return False
        best: tuple[int, str] | None = None
        with zipfile.ZipFile(dwf_path) as zf:
            for info in zf.infolist():
                name = info.filename.lower()
                if name.endswith((".png", ".jpg", ".jpeg")):
                    if best is None or info.file_size > best[0]:
                        best = (info.file_size, info.filename)
            if best is None or best[0] < _MIN_EMBEDDED_PREVIEW:
                return False
            data = zf.read(best[1])
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.save(out_png, format="PNG")
        return out_png.exists() and out_png.stat().st_size > 0
    except Exception:
        return False


# ── public entry point ──────────────────────────────────────────────────────────
def convert_to_png(file_path: str, out_dir: str | os.PathLike | None = None,
                   dpi: int = _DEFAULT_DPI, use_cache: bool = True) -> ConversionResult:
    """Render a CAD file (DWG/DXF/DWF) to a cached PNG.

    The PNG is written to `out_dir` (default: alongside the source) as
    `<stem>.cadrender.png` and reused on subsequent calls.
    """
    src = Path(file_path)
    suffix = src.suffix.lower()
    if suffix not in CAD_SUFFIXES:
        return ConversionResult(ok=False, reason=f"Not a CAD file: {suffix}")

    out_dir_p = Path(out_dir) if out_dir else src.parent
    out_png = out_dir_p / (src.stem + RENDER_SUFFIX)

    if use_cache and out_png.exists() and out_png.stat().st_size > 0:
        return ConversionResult(ok=True, png_path=str(out_png), converter="cache")

    if suffix == ".dwf":
        # DWF doesn't need ezdxf — try the embedded-raster path first.
        if _dwf_extract_preview(src, out_png):
            return ConversionResult(ok=True, png_path=str(out_png), converter="dwf-preview")
        return ConversionResult(ok=False, reason=_MSG_DWF_UNSUPPORTED)

    if not _HAS_EZDXF:
        return ConversionResult(ok=False, reason=_MSG_NO_EZDXF)

    if suffix == ".dxf":
        ok, hints = _render_dxf(src, out_png, dpi)
        if ok:
            return ConversionResult(ok=True, png_path=str(out_png),
                                    converter="ezdxf", text_hints=hints)
        return ConversionResult(ok=False, reason=_MSG_BAD_FILE.format(ext="DXF"))

    # .dwg
    with tempfile.TemporaryDirectory() as tmp:
        dxf, kind = _dwg_to_dxf(src, Path(tmp))
        if dxf is None and kind is None:
            return ConversionResult(ok=False, reason=_MSG_DWG_NO_CONVERTER)
        if dxf is None:
            return ConversionResult(ok=False, reason=_MSG_BAD_FILE.format(ext="DWG"))
        ok, hints = _render_dxf(dxf, out_png, dpi)
        if ok:
            return ConversionResult(ok=True, png_path=str(out_png),
                                    converter=kind, text_hints=hints)
        return ConversionResult(ok=False, reason=_MSG_BAD_FILE.format(ext="DWG"))


def capabilities() -> dict:
    """What CAD support is actually available in this environment."""
    conv = _find_converter()
    return {
        "ezdxf": _HAS_EZDXF,
        "dxf": _HAS_EZDXF,
        "dwg": _HAS_EZDXF and conv is not None,
        "dwf": True,                       # best-effort preview always attempted
        "converter": conv[0] if conv else None,
    }


# ── self-test (project convention: runnable without pytest) ─────────────────────
if __name__ == "__main__":
    import sys

    failures = 0

    def check(label: str, cond: bool) -> None:
        global failures
        print(f"  {'PASS' if cond else 'FAIL'}  {label}")
        if not cond:
            failures += 1

    print("cad_convert self-test")
    print("capabilities:", capabilities())

    # is_cad
    check("is_cad('.dwg')", is_cad(".dwg"))
    check("is_cad('plan.DXF')", is_cad("plan.DXF"))
    check("is_cad('x.dwf')", is_cad("x.dwf"))
    check("not is_cad('x.png')", not is_cad("x.png"))
    check("not is_cad('report.pdf')", not is_cad("report.pdf"))

    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)

        # 1) Render a real DXF with a title block.
        if _HAS_EZDXF:
            doc = ezdxf.new("R2010", setup=True)
            msp = doc.modelspace()
            msp.add_lwpolyline([(0, 0), (420, 0), (420, 297), (0, 297), (0, 0)])
            msp.add_line((300, 0), (300, 40))
            msp.add_line((300, 40), (420, 40))
            msp.add_text("GROUND FLOOR PLAN", height=8).set_placement((305, 22))
            msp.add_text("SCALE 1:100", height=5).set_placement((305, 8))
            dxf_file = dd / "plan.dxf"
            doc.saveas(dxf_file)

            res = convert_to_png(str(dxf_file), out_dir=dd)
            check("DXF converts ok", res.ok)
            check("DXF png exists", bool(res.png_path) and Path(res.png_path).exists())
            check("DXF png is a real PNG",
                  bool(res.png_path) and Path(res.png_path).read_bytes()[:8] == _PNG_MAGIC)
            check("DXF text hints captured (title block)",
                  any("GROUND FLOOR" in h.upper() for h in res.text_hints))

            # 2) Cache hit on a second call.
            res2 = convert_to_png(str(dxf_file), out_dir=dd)
            check("DXF second call uses cache", res2.converter == "cache" and res2.ok)
        else:
            print("  SKIP  DXF render tests (ezdxf unavailable)")

        # 3) DWG with no converter present → clear, specific error.
        if _find_converter() is None:
            fake_dwg = dd / "fake.dwg"
            fake_dwg.write_bytes(b"AC1027\x00not-a-real-dwg")
            res = convert_to_png(str(fake_dwg), out_dir=dd)
            check("DWG without converter -> not ok", not res.ok)
            check("DWG without converter -> asks for PDF/DXF",
                  bool(res.reason) and "PDF or DXF" in res.reason)
        else:
            print("  SKIP  DWG no-converter test (a converter is installed)")

        # 4) Bogus DWF (not a zip) -> clear error.
        bad_dwf = dd / "bad.dwf"
        bad_dwf.write_bytes(b"not a dwf package")
        res = convert_to_png(str(bad_dwf), out_dir=dd)
        check("invalid DWF -> not ok", not res.ok)
        check("invalid DWF -> asks for PDF/DXF",
              bool(res.reason) and "PDF or DXF" in res.reason)

    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
