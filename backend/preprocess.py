"""
Image preprocessing for drawing extraction (Tier-1 + Tier-2).

Every function is defensive: if an optional dependency (PyMuPDF, OpenCV) or a
system binary is missing, or the input is malformed, it falls back to the most
sensible result instead of raising — so the pipeline keeps working.

Pipeline role:
    PDF  ──render_pdf_to_images──▶ high-DPI PNG ─┐
    image ───────────────────────────────────────┤─ clean_image ─▶ crop_title_block
                                                  ┘                └▶ tile_image
"""

import io
from pathlib import Path

from PIL import Image

try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except Exception:                       # pragma: no cover - env dependent
    _HAS_FITZ = False

try:
    import cv2
    import numpy as np
    _HAS_CV2 = True
except Exception:                       # pragma: no cover - env dependent
    _HAS_CV2 = False

try:
    import cad_convert                  # CAD (DWG/DXF/DWF) → raster rendering
    _HAS_CAD = True
except Exception:                       # pragma: no cover - env dependent
    _HAS_CAD = False


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp"}


def _resolve_raster_path(file_path: str) -> str:
    """If `file_path` is a CAD file, render it to a cached PNG and return that path.

    Returns the original path unchanged when it isn't CAD, when CAD support is
    unavailable, or when conversion fails — callers then degrade as they would for
    any unreadable input. Conversion is cached, so repeated calls are cheap.
    """
    if not _HAS_CAD:
        return file_path
    if Path(file_path).suffix.lower() not in cad_convert.CAD_SUFFIXES:
        return file_path
    result = cad_convert.convert_to_png(file_path)
    return result.png_path if (result.ok and result.png_path) else file_path


# ── basic helpers ─────────────────────────────────────────────────────────────
def _pil_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def load_image(image_bytes: bytes) -> Image.Image | None:
    try:
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return None


# ── Tier-1: render a PDF to images ─────────────────────────────────────────────
def render_pdf_to_images(file_path: str, dpi: int = 220, max_pages: int = 3) -> list[bytes]:
    """Render the first `max_pages` PDF pages to PNG bytes at `dpi`.

    Returns [] if PyMuPDF is unavailable or rendering fails (caller degrades).
    """
    if not _HAS_FITZ:
        return []
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        out: list[bytes] = []
        with fitz.open(file_path) as doc:
            for page in doc[:max_pages]:
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                out.append(pix.tobytes("png"))
        return out
    except Exception:
        return []


# ── Tier-2: clean an image (deskew / contrast / upscale / denoise) ──────────────
def clean_image(image_bytes: bytes, min_long_edge: int = 1600) -> bytes:
    """Improve legibility for scans/photos. Returns cleaned PNG bytes,
    or the original bytes if OpenCV is unavailable or anything fails."""
    if not _HAS_CV2:
        return image_bytes
    try:
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Deskew using the dominant text angle (minAreaRect over dark pixels).
        gray = _deskew(gray)

        # Contrast (CLAHE) — robust local contrast for faint linework/text.
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

        # Light denoise.
        gray = cv2.fastNlMeansDenoising(gray, h=7)

        # Upscale small images so small title-block text is readable.
        h, w = gray.shape[:2]
        long_edge = max(h, w)
        if long_edge < min_long_edge:
            scale = min_long_edge / float(long_edge)
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)),
                              interpolation=cv2.INTER_CUBIC)

        ok, buf = cv2.imencode(".png", gray)
        return buf.tobytes() if ok else image_bytes
    except Exception:
        return image_bytes


def _deskew(gray):
    """Estimate and correct small skew angles. No-op on failure."""
    try:
        inv = cv2.bitwise_not(gray)
        _, thresh = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        coords = cv2.findNonZero(thresh)
        if coords is None:
            return gray
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = 90 + angle
        if abs(angle) < 0.5 or abs(angle) > 20:   # ignore noise / large rotations
            return gray
        h, w = gray.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        return cv2.warpAffine(gray, m, (w, h),
                              flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        return gray


# ── Tier-1: crop the title block region(s) ──────────────────────────────────────
def crop_title_block(image_bytes: bytes) -> list[bytes]:
    """Return zoomed crops where title blocks usually live: the bottom strip and
    the bottom-right corner. Helps the model read small title-block text."""
    img = load_image(image_bytes)
    if img is None:
        return []
    try:
        w, h = img.size
        crops = []
        # bottom 28% strip (full width)
        crops.append(img.crop((0, int(h * 0.72), w, h)))
        # bottom-right quadrant (most common title-block location)
        crops.append(img.crop((int(w * 0.55), int(h * 0.55), w, h)))
        # upscale each crop 2x for clarity
        out = []
        for c in crops:
            cw, ch = c.size
            if max(cw, ch) < 1400:
                c = c.resize((cw * 2, ch * 2), Image.LANCZOS)
            out.append(_pil_to_png_bytes(c))
        return out
    except Exception:
        return []


# ── Tier-2: tile a large sheet (for counts / dense content) ─────────────────────
def tile_image(image_bytes: bytes, grid=(2, 2)) -> list[bytes]:
    img = load_image(image_bytes)
    if img is None:
        return []
    try:
        w, h = img.size
        rows, cols = grid
        tw, th = w // cols, h // rows
        tiles = []
        for r in range(rows):
            for c in range(cols):
                box = (c * tw, r * th,
                       (c + 1) * tw if c < cols - 1 else w,
                       (r + 1) * th if r < rows - 1 else h)
                tiles.append(_pil_to_png_bytes(img.crop(box)))
        return tiles
    except Exception:
        return []


# ── Convenience: build the best image set for a drawing ─────────────────────────
def build_images(file_path: str, dpi: int = 220, clean: bool = True) -> dict:
    """Produce the image set for extraction.

    Returns:
      {
        "full":   bytes | None,   # primary full-sheet PNG (None if it can't be made)
        "crops":  [bytes, ...],   # zoomed title-block crops
        "media_type": "image/png",
        "page_count": int,
        "is_pdf": bool,
      }
    """
    file_path = _resolve_raster_path(file_path)   # CAD → rendered PNG (cached)
    suffix = Path(file_path).suffix.lower()
    is_pdf = suffix == ".pdf"

    base: bytes | None = None
    page_count = 1
    if is_pdf:
        pages = render_pdf_to_images(file_path, dpi=dpi)
        page_count = len(pages)
        base = pages[0] if pages else None
    elif suffix in IMAGE_SUFFIXES:
        try:
            base = Path(file_path).read_bytes()
        except Exception:
            base = None

    if base is None:
        return {"full": None, "crops": [], "media_type": "image/png",
                "page_count": page_count, "is_pdf": is_pdf}

    full = clean_image(base) if clean else base
    crops = crop_title_block(full)
    return {"full": full, "crops": crops, "media_type": "image/png",
            "page_count": page_count, "is_pdf": is_pdf}


def sharpness_score(file_path: str) -> float | None:
    """Laplacian-variance sharpness of the RAW primary raster (higher = sharper).

    Measured on the *un-cleaned* image (cleaning denoises/upscales and would skew
    the metric). For PDFs the first rendered page is used. Returns None if OpenCV
    is unavailable or the image can't be decoded — the caller then skips the gate.
    """
    if not _HAS_CV2:
        return None
    try:
        file_path = _resolve_raster_path(file_path)   # CAD → rendered PNG (cached)
        suffix = Path(file_path).suffix.lower()
        if suffix == ".pdf":
            pages = render_pdf_to_images(file_path, dpi=150, max_pages=1)
            raw = pages[0] if pages else None
        elif suffix in IMAGE_SUFFIXES:
            raw = Path(file_path).read_bytes()
        else:
            raw = None
        if not raw:
            return None
        arr = np.frombuffer(raw, dtype=np.uint8)
        gray = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        if gray is None:
            return None
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        return None


def capabilities() -> dict:
    """What preprocessing is actually available in this environment."""
    caps = {"pdf_render": _HAS_FITZ, "image_clean": _HAS_CV2, "cad": _HAS_CAD}
    if _HAS_CAD:
        caps["cad_detail"] = cad_convert.capabilities()
    return caps
