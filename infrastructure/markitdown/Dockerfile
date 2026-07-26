# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm

WORKDIR /app

# apt packages rarely change — cache mount speeds rebuilds when the layer is invalidated.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    libmagic1 \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-deu \
    tesseract-ocr-hun

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip,sharing=shared \
  pip install -r requirements.txt

COPY app.py .

RUN useradd --uid 1001 --create-home markitdown \
  && chown -R markitdown:markitdown /app
USER markitdown

ENV PORT=8080
ENV TESSERACT_LANG=eng
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
