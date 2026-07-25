"""HTTP convert sidecar wrapping Microsoft MarkItDown + selectable OCR."""

from __future__ import annotations

import base64
import io
import mimetypes
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="kh-markitdown", version="0.2.0")

OcrEngine = Literal["none", "vision", "tesseract"]
OCR_ENGINES: tuple[OcrEngine, ...] = ("none", "vision", "tesseract")

# Primary packs aligned with UI locales (en/de/hu). Sidecar Dockerfile installs all three.
OcrLang = Literal["eng", "deu", "hun"]
OCR_LANGS: tuple[OcrLang, ...] = ("eng", "deu", "hun")
OCR_LANG_LABELS: dict[OcrLang, str] = {
    "eng": "English",
    "deu": "German",
    "hun": "Hungarian",
}

IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

VISION_OCR_PROMPT = (
    "Extract all readable text from this image exactly. "
    "Preserve tables, amounts, dates, invoice numbers, and line breaks. "
    "Do not invent missing text. Return plain text only."
)


def _vision_configured() -> bool:
    return bool(os.environ.get("VISION_LLM_BASE_URL"))


def _tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def _default_tesseract_lang() -> str:
    return os.environ.get("TESSERACT_LANG") or "eng"


def _normalize_ocr_lang(value: str | None) -> OcrLang:
    raw = (value or "").strip().lower()
    if not raw:
        primary = (_default_tesseract_lang().split("+")[0] or "eng").strip().lower()
        raw = primary
    if raw not in OCR_LANGS:
        raise HTTPException(
            status_code=400,
            detail=f"ocrLang must be one of: {', '.join(OCR_LANGS)}",
        )
    return raw  # type: ignore[return-value]


def _tesseract_lang_pack(primary: OcrLang) -> str:
    """Build Tesseract `-l` value; add eng as secondary for non-English primaries."""
    if primary == "eng":
        return "eng"
    return f"{primary}+eng"


def _normalize_engine(value: str | None) -> OcrEngine:
    engine = (value or "none").strip().lower()
    if engine not in OCR_ENGINES:
        raise HTTPException(
            status_code=400,
            detail=f"ocrEngine must be one of: {', '.join(OCR_ENGINES)}",
        )
    return engine  # type: ignore[return-value]


def _vision_prompt(ocr_lang: OcrLang) -> str:
    label = OCR_LANG_LABELS[ocr_lang]
    return (
        f"{VISION_OCR_PROMPT} "
        f"The document language is primarily {label}; preserve that language in the output."
    )


def _build_markitdown(ocr_engine: OcrEngine, ocr_lang: OcrLang) -> Any:
    from markitdown import MarkItDown

    if ocr_engine != "vision":
        return MarkItDown(enable_plugins=False)

    if not _vision_configured():
        raise HTTPException(
            status_code=422,
            detail=(
                "ocrEngine=vision requires VISION_LLM_BASE_URL "
                "(OpenAI-compatible endpoint, e.g. Ollama http://host:11434/v1)"
            ),
        )

    from openai import OpenAI

    base_url = os.environ["VISION_LLM_BASE_URL"].rstrip("/")
    # Ollama and many local gateways accept any non-empty key.
    api_key = os.environ.get("VISION_LLM_API_KEY") or "ollama"
    model = os.environ.get("VISION_LLM_MODEL") or "gpt-4o-mini"
    client = OpenAI(api_key=api_key, base_url=base_url)
    return MarkItDown(
        enable_plugins=True,
        llm_client=client,
        llm_model=model,
        llm_prompt=_vision_prompt(ocr_lang),
    )


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


def _ocr_pil_image(img: Any, lang_pack: str) -> str:
    import pytesseract

    text = pytesseract.image_to_string(img, lang=lang_pack)
    return (text or "").strip()


def _ocr_image_bytes(data: bytes, lang_pack: str) -> str:
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        return _ocr_pil_image(img.convert("RGB"), lang_pack)


def _ocr_pdf_pages(path: Path, warnings: list[str], lang_pack: str) -> list[str]:
    pages: list[str] = []
    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"pypdfium2 unavailable for PDF OCR: {exc}")
        return pages

    try:
        pdf = pdfium.PdfDocument(str(path))
        for index in range(len(pdf)):
            page = pdf[index]
            bitmap = page.render(scale=2.0)
            pil = bitmap.to_pil()
            text = _ocr_pil_image(pil, lang_pack)
            if text:
                pages.append(text)
            page.close()
        pdf.close()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"tesseract PDF page OCR failed: {exc}")
    return pages


def _apply_tesseract_ocr(
    *,
    path: Path,
    content_type: str,
    filename: str,
    lane: str,
    markdown: str,
    images: list[dict[str, str]],
    warnings: list[str],
    ocr_lang: OcrLang,
) -> str:
    if not _tesseract_available():
        raise HTTPException(
            status_code=422,
            detail="ocrEngine=tesseract requires the tesseract binary in kh-markitdown",
        )

    lang_pack = _tesseract_lang_pack(ocr_lang)
    blocks: list[str] = []
    suffix = path.suffix.lower()
    is_image = content_type in IMAGE_CONTENT_TYPES or suffix in IMAGE_EXTENSIONS
    is_pdf = suffix == ".pdf" or content_type == "application/pdf"

    if is_image:
        try:
            text = _ocr_image_bytes(path.read_bytes(), lang_pack)
            if text:
                blocks.append(text)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"tesseract image OCR failed: {exc}")
    else:
        for img in images:
            try:
                data = base64.b64decode(img["dataBase64"])
                text = _ocr_image_bytes(data, lang_pack)
                if text:
                    blocks.append(f"### {img['filename']}\n\n{text}")
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"tesseract OCR failed for {img.get('filename')}: {exc}")

        # Scanned PDFs often have no embedded XObject images — render pages.
        if is_pdf and (not blocks or len(markdown.strip()) < 80):
            page_texts = _ocr_pdf_pages(path, warnings, lang_pack)
            if page_texts:
                blocks = [
                    f"### Page {i + 1}\n\n{text}" for i, text in enumerate(page_texts)
                ]

    if not blocks:
        warnings.append("tesseract returned no text")
        return markdown

    ocr_section = "## OCR text\n\n" + "\n\n".join(blocks)
    if lane == "image":
        stem = Path(filename).stem
        embed = f"![{stem}](attachment:0)\n\n" if images else ""
        return f"{embed}{ocr_section}\n"

    base = markdown.strip()
    if base:
        return f"{base}\n\n{ocr_section}\n"
    return f"# {Path(filename).stem}\n\n{ocr_section}\n"


@app.get("/health")
def health() -> dict[str, Any]:
    vision = _vision_configured()
    tesseract = _tesseract_available()
    engines: list[str] = ["none"]
    if vision:
        engines.append("vision")
    if tesseract:
        engines.append("tesseract")
    return {
        "status": "ok",
        "service": "kh-markitdown",
        "vision": vision,
        "tesseract": tesseract,
        "engines": engines,
        "tesseractLangs": list(OCR_LANGS),
        "tesseractLang": _default_tesseract_lang(),
    }


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    lane: str = Form(default="document"),
    ocrEngine: str = Form(default="none"),
    ocrLang: str = Form(default=""),
) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename required")

    ocr_engine = _normalize_engine(ocrEngine)
    ocr_lang = _normalize_ocr_lang(ocrLang)
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
            md = _build_markitdown(ocr_engine, ocr_lang)
            result = md.convert(str(path))
            markdown = (
                getattr(result, "markdown", None)
                or getattr(result, "text_content", None)
                or ""
            ).strip()
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"conversion failed: {exc}") from exc

        if ocr_engine == "tesseract":
            markdown = _apply_tesseract_ocr(
                path=path,
                content_type=content_type,
                filename=file.filename,
                lane=lane,
                markdown=markdown,
                images=images,
                warnings=warnings,
                ocr_lang=ocr_lang,
            )

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
            "visionUsed": ocr_engine == "vision",
            "ocrEngine": ocr_engine,
            "ocrLang": ocr_lang,
            "tesseractLangPack": _tesseract_lang_pack(ocr_lang),
        }
        return JSONResponse(payload)
