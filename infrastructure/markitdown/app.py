"""HTTP convert sidecar wrapping Microsoft MarkItDown + image extraction."""

from __future__ import annotations

import base64
import io
import mimetypes
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="kh-markitdown", version="0.1.0")

IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _vision_enabled() -> bool:
    return bool(os.environ.get("VISION_LLM_API_KEY") and os.environ.get("VISION_LLM_BASE_URL"))


def _build_markitdown() -> Any:
    from markitdown import MarkItDown

    if not _vision_enabled():
        return MarkItDown(enable_plugins=False)

    from openai import OpenAI

    client = OpenAI(
        api_key=os.environ["VISION_LLM_API_KEY"],
        base_url=os.environ["VISION_LLM_BASE_URL"].rstrip("/"),
    )
    model = os.environ.get("VISION_LLM_MODEL") or "gpt-4o-mini"
    return MarkItDown(enable_plugins=False, llm_client=client, llm_model=model)


def _guess_content_type(filename: str, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(filename)
    if guessed == "image/jpg":
        return "image/jpeg"
    return guessed or fallback


def _image_entry(filename: str, data: bytes, content_type: str | None = None) -> dict[str, str]:
    ct = content_type or _guess_content_type(filename, "image/png")
    if ct == "image/jpg":
        ct = "image/jpeg"
    return {
        "filename": filename,
        "contentType": ct,
        "dataBase64": base64.b64encode(data).decode("ascii"),
    }


def _extract_images_docx(path: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if not name.startswith("word/media/"):
                    continue
                data = zf.read(name)
                if not data:
                    continue
                filename = Path(name).name
                out.append(_image_entry(filename, data))
    except Exception as exc:  # noqa: BLE001
        return [{"_warning": f"docx image extract failed: {exc}"}]  # type: ignore[list-item]
    return out


def _extract_images_pptx(path: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if not name.startswith("ppt/media/"):
                    continue
                data = zf.read(name)
                if not data:
                    continue
                filename = Path(name).name
                out.append(_image_entry(filename, data))
    except Exception as exc:  # noqa: BLE001
        return [{"_warning": f"pptx image extract failed: {exc}"}]  # type: ignore[list-item]
    return out


def _extract_images_pdf(path: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        idx = 0
        for page in reader.pages:
            try:
                resources = page.get("/Resources")
                if resources is None:
                    continue
                xobject = resources.get("/XObject")
                if xobject is None:
                    continue
                xobject = xobject.get_object()
                for key in xobject:
                    obj = xobject[key].get_object()
                    if obj.get("/Subtype") != "/Image":
                        continue
                    data = obj.get_data()
                    if not data:
                        continue
                    idx += 1
                    filt = str(obj.get("/Filter", ""))
                    ext = ".bin"
                    ct = "application/octet-stream"
                    if "DCTDecode" in filt:
                        ext, ct = ".jpg", "image/jpeg"
                    elif "JPXDecode" in filt:
                        ext, ct = ".jp2", "image/jp2"
                    elif "FlateDecode" in filt:
                        # Often raw; try PNG via Pillow when possible.
                        try:
                            from PIL import Image

                            width = int(obj.get("/Width", 0))
                            height = int(obj.get("/Height", 0))
                            color = str(obj.get("/ColorSpace", ""))
                            mode = "RGB" if "RGB" in color else "L"
                            if width and height:
                                img = Image.frombytes(mode, (width, height), data)
                                buf = io.BytesIO()
                                img.save(buf, format="PNG")
                                data = buf.getvalue()
                                ext, ct = ".png", "image/png"
                        except Exception:  # noqa: BLE001
                            continue
                    else:
                        continue
                    out.append(_image_entry(f"pdf-image-{idx}{ext}", data, ct))
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        return [{"_warning": f"pdf image extract failed: {exc}"}]  # type: ignore[list-item]
    return out


def _extract_images(path: Path, content_type: str, filename: str) -> tuple[list[dict[str, str]], list[str]]:
    warnings: list[str] = []
    suffix = path.suffix.lower()
    name_lower = filename.lower()

    if content_type in IMAGE_CONTENT_TYPES or suffix in IMAGE_EXTENSIONS:
        data = path.read_bytes()
        return [_image_entry(filename or f"image{suffix or '.bin'}", data, content_type)], warnings

    raw: list[Any]
    if suffix == ".docx" or name_lower.endswith(".docx") or "wordprocessingml" in content_type:
        raw = _extract_images_docx(path)
    elif suffix == ".pptx" or name_lower.endswith(".pptx") or "presentationml" in content_type:
        raw = _extract_images_pptx(path)
    elif suffix == ".pdf" or content_type == "application/pdf":
        raw = _extract_images_pdf(path)
    else:
        return [], warnings

    images: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict) and "_warning" in item:
            warnings.append(str(item["_warning"]))
        elif isinstance(item, dict) and "dataBase64" in item:
            images.append(item)
    return images, warnings


def _title_hint(filename: str, markdown: str) -> str:
    stem = Path(filename).stem.strip() if filename else ""
    if stem and stem not in {"upload", "file", "document", "image"}:
        return stem[:200]
    for line in markdown.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()[:200]
    return stem[:200] or "Imported document"


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "kh-markitdown",
        "vision": _vision_enabled(),
    }


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    lane: str = Form(default="document"),
) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename required")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    content_type = (file.content_type or _guess_content_type(file.filename)).lower()
    suffix = Path(file.filename).suffix or ""

    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix="kh-mid-") as tmp:
        path = Path(tmp) / (file.filename or f"upload{suffix}")
        path.write_bytes(data)

        images, extract_warnings = _extract_images(path, content_type, file.filename)
        warnings.extend(extract_warnings)

        try:
            md = _build_markitdown()
            result = md.convert(str(path))
            markdown = (getattr(result, "markdown", None) or getattr(result, "text_content", None) or "").strip()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"conversion failed: {exc}") from exc

        if not markdown:
            if lane == "image" and images:
                markdown = f"![{Path(file.filename).stem}](attachment:0)\n"
            else:
                warnings.append("MarkItDown returned empty markdown")
                markdown = f"# {Path(file.filename).stem}\n\n_(No extractable text.)_\n"

        # Ensure image lane embeds reference attachment indices for the hub rewriter.
        if lane == "image" and images and "attachment:0" not in markdown and "](" not in markdown:
            markdown = f"![{Path(file.filename).stem}](attachment:0)\n\n{markdown}"

        # For office extracts, append placeholders for images not already referenced.
        if images and lane != "image":
            missing = []
            for i, img in enumerate(images):
                token = f"attachment:{i}"
                if token not in markdown and img["filename"] not in markdown:
                    missing.append(f"![{img['filename']}]({token})")
            if missing:
                markdown = markdown.rstrip() + "\n\n## Extracted images\n\n" + "\n\n".join(missing) + "\n"

        payload = {
            "markdown": markdown,
            "titleHint": _title_hint(file.filename, markdown),
            "images": images,
            "warnings": warnings,
            "visionUsed": _vision_enabled(),
        }
        return JSONResponse(payload)
