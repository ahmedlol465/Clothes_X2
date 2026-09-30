"""The HTTP surface: `POST /api/v1/clothing/analyze`.

The response is wrapped in the same `{success, data, timestamp}` envelope that
`backend/src/common/interceptors/response.interceptor.ts` produces, so the
NestJS side can forward it unchanged instead of reshaping it twice.

`success: false` is a **valid 200 response**, not an error. "No clothing item
detected" and "the photo is too blurry" are answers, and the client needs to
show them to the user. Only malformed requests and service failures are 4xx/5xx.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Iterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..common.logging import get_logger
from ..config.settings import Settings, get_settings
from ..schemas import AnalysisOptions, AnalysisResult
from ..pipeline import ClothingAnalysisPipeline

log = get_logger(__name__)

router = APIRouter(prefix="/api/v1/clothing", tags=["clothing"])

#: Magic-number prefixes for the formats a phone upload actually produces.
#: Anything else is rejected before it reaches OpenCV.
ALLOWED_SIGNATURES: tuple[bytes, ...] = (
    b"\xff\xd8\xff",  # JPEG
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"RIFF",  # WebP
    b"BM",  # BMP
    b"II*\x00",  # TIFF, little-endian
    b"MM\x00*",  # TIFF, big-endian
)
ALLOWED_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/jpg"}
)


class AnalyzeResponse(BaseModel):
    """Mirrors `ApiEnvelope` in the NestJS backend."""

    success: bool
    data: AnalysisResult
    timestamp: str = Field(description="ISO-8601 UTC.")


def get_pipeline(request: Request) -> ClothingAnalysisPipeline:
    pipeline = getattr(request.app.state, "pipeline", None)
    if pipeline is None:
        # The service started without models. This is reachable in `offline`
        # and in tests, so it is a real branch rather than a defensive one.
        raise HTTPException(
            status_code=503,
            detail="Analysis pipeline is not initialised; check service startup logs.",
        )
    return pipeline


def get_settings_dep() -> Settings:
    return get_settings()


@router.get("/vocabulary", summary="Label vocabulary the pipeline can return")
def vocabulary(settings: Settings = Depends(get_settings_dep)) -> dict[str, Any]:
    """So the client can build its filter UI from the same source of truth.

    Without this, the Flutter dropdowns and the service drift apart silently.
    """
    from ..config.vocabulary import get_vocabulary

    vocab = get_vocabulary(settings.labels_file)
    return {
        "version": vocab.version,
        "attributes": {
            name: {
                "labels": [
                    {"value": label.value, "prompt": label.prompt, "group": label.group}
                    for label in spec
                ],
                "enabled": spec.enabled,
                "confidence_cap": spec.confidence_cap,
            }
            for name, spec in vocab.attributes.items()
        },
        "detector_group_map": vocab.detector_group_map,
    }


@router.get("/models", summary="Model revisions and licences in use")
def models(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    manager = getattr(request.app.state, "model_manager", None)
    stats = manager.load_stats() if manager is not None else None
    return {
        "device": settings.resolved_device(),
        "detector": settings.detector_model,
        "segmenter": settings.segmenter_model,
        "fashion_model": settings.fashion_model,
        "secondary_classifier": (
            settings.secondary_classifier_model if settings.enable_secondary_classifier else None
        ),
        "revisions": getattr(stats, "revisions", {}) if stats is not None else {},
        "loaded": bool(getattr(manager, "is_loaded", False)) if manager is not None else False,
    }


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Analyse one clothing photo",
)
async def analyze(
    request: Request,
    file: UploadFile = File(..., description="A single photo of one or more garments."),
    include_embedding: bool = Form(True),
    include_mask: bool = Form(False),
    max_items: int | None = Form(None, ge=1, le=32),
    detect_single_item_fallback: bool = Form(True),
    pipeline: ClothingAnalysisPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings_dep),
) -> AnalyzeResponse:
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(payload) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image is {len(payload) / 1e6:.1f} MB; the limit is "
                f"{settings.max_upload_bytes / 1e6:.1f} MB."
            ),
        )
    if not _sniff_ok(payload):
        raise HTTPException(
            status_code=415,
            detail="Unsupported image format. Use JPEG, PNG, WebP, BMP or TIFF.",
        )

    options = AnalysisOptions(
        include_embedding=include_embedding,
        include_mask=include_mask,
        max_items=max_items,
        detect_single_item_fallback=detect_single_item_fallback,
    )

    result = await _run(pipeline, payload, options, request_id)

    elapsed = time.perf_counter() - started
    if elapsed > settings.request_timeout_s:
        # The work finished, just too slowly to be worth returning. Surfacing
        # this is better than letting a client-side timeout fire with no
        # explanation.
        log.warning("analysis_slow", request_id=request_id, elapsed_s=round(elapsed, 2))

    return AnalyzeResponse(
        success=result.success,
        data=result,
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


async def _run(
    pipeline: ClothingAnalysisPipeline,
    payload: bytes,
    options: AnalysisOptions,
    request_id: str,
) -> AnalysisResult:
    """Run the pipeline off the event loop.

    Inference is CPU-bound and takes seconds; running it inline would block
    every other request the service is serving, including `/health`.
    """
    import anyio

    return await anyio.to_thread.run_sync(
        lambda: pipeline.analyze(payload, options=options, request_id=request_id)
    )


def _sniff_ok(payload: bytes) -> bool:
    """Check the bytes, not the client's content type.

    A client can claim any content type; the magic number is the evidence.
    """
    if not payload.startswith(ALLOWED_SIGNATURES):
        return False
    return True


__all__ = ["router"]
