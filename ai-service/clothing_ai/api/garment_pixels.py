"""`POST /api/v1/clothing/garment-pixels`: optional helper for the colour step.

Returns a PNG made only of the garment's pixels, or 204 when no garment is
found. The Node backend treats every failure here as "use the original photo".
"""

from __future__ import annotations

import hashlib
import io
from collections import OrderedDict

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from PIL import Image

from ..segmentation.pixels import garment_pixel_mosaic

router = APIRouter(prefix="/api/v1/clothing", tags=["clothing"])

MAX_BYTES = 12 * 1024 * 1024
MAX_SIDE = 1280


_cache: OrderedDict[str, bytes | None] = OrderedDict()
_CACHE_SIZE = 64


def _run(payload: bytes) -> bytes | None:
    key = hashlib.sha1(payload).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    result = _compute(payload)
    _cache[key] = result
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result


def _compute(payload: bytes) -> bytes | None:
    image = Image.open(io.BytesIO(payload))
    image.load()
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    mosaic = garment_pixel_mosaic(image)
    if mosaic is None:
        return None
    buf = io.BytesIO()
    mosaic.save(buf, format="PNG")
    return buf.getvalue()


@router.post("/garment-pixels", summary="Garment pixels only, for colour reading")
async def garment_pixels(file: UploadFile = File(...)) -> Response:
    payload = await file.read()
    if not payload or len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="empty or too large")
    try:
        png = await run_in_threadpool(_run, payload)
    except Exception as exc:  # noqa: BLE001 - caller falls back to the photo
        raise HTTPException(status_code=422, detail=f"could not process: {type(exc).__name__}")
    if png is None:
        return Response(status_code=204)
    return Response(content=png, media_type="image/png")
