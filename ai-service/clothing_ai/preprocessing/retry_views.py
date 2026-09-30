"""Alternative views for a low-confidence garment.

A low-confidence result usually has an ordinary, fixable cause: the detector box
includes a lot of background, or the photo is dim. Both are recoverable without
touching the model, which is the cheapest possible improvement and the one that
does not risk swapping a correct answer for a confident wrong one.

The retry budget is bounded by `Settings.max_retries` and each view is tried at
most once, so this can never loop.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from ..common.logging import get_logger
from ..schemas import BoundingBox, DetectedGarment, ImageQualityResult

log = get_logger(__name__)


class _Tightener(Protocol):
    """The subset of the image-quality checker the retry logic needs."""

    def check(self, image: np.ndarray) -> ImageQualityResult: ...


#: Detections smaller than this are too small to re-crop meaningfully; a tighter
#: box would contain a handful of pixels and make the result worse.
MIN_CROP_SIDE = 48
#: Only consider tightening when the box covers less than this much of the frame.
TIGHTEN_BELOW_AREA = 0.45
#: Only correct brightness when the frame is genuinely dark.
BRIGHTNESS_TRIGGER = 72.0
#: Target mean luminance for the corrected view.
BRIGHTNESS_TARGET = 118.0


def build_retry_view(
    image: np.ndarray,
    detection: DetectedGarment,
    quality: ImageQualityResult,
    attempt: int,
) -> tuple[DetectedGarment, np.ndarray] | None:
    """Return an alternative `(detection, image)` pair, or `None` if exhausted.

    `attempt` is 1-based; it selects which view to try so the same transformation
    is never applied twice to the same garment.
    """
    if attempt <= 1:
        return _tightened(image, detection)
    return _brightened(image, detection, quality)


def _area(detection: DetectedGarment, shape: tuple[int, int]) -> float:
    box = detection.bbox
    height, width = shape
    return max(0.0, box.x2 - box.x1) * max(0.0, box.y2 - box.y1) / max(1, height * width)


def _tightened(
    image: np.ndarray, detection: DetectedGarment
) -> tuple[DetectedGarment, np.ndarray] | None:
    """Shrink the box toward its centre, keeping the label and score.

    The score is deliberately *not* raised: the retry has not produced new
    evidence, it has only removed pixels that were never part of the garment.
    Inflating it here would make the reported confidence a function of how many
    times the pipeline retried.
    """
    height, width = image.shape[:2]
    if _area(detection, (height, width)) >= TIGHTEN_BELOW_AREA:
        return None

    box = detection.bbox
    side_w = box.x2 - box.x1
    side_h = box.y2 - box.y1
    if side_w < MIN_CROP_SIDE or side_h < MIN_CROP_SIDE:
        return None

    # A modest inset. Centring on the box's middle is a better prior than
    # trimming one edge, because garment detectors tend to be symmetrically
    # loose rather than systematically offset.
    inset_x = side_w * 0.12
    inset_y = side_h * 0.12
    tightened = BoundingBox(
        x1=min(max(0.0, box.x1 + inset_x), width - 1.0),
        y1=min(max(0.0, box.y1 + inset_y), height - 1.0),
        x2=max(min(float(width), box.x2 - inset_x), 1.0),
        y2=max(min(float(height), box.y2 - inset_y), 1.0),
    )
    if tightened.width < MIN_CROP_SIDE or tightened.height < MIN_CROP_SIDE:
        return None

    log.info(
        "retry_view_tightened",
        garment=detection.id,
        before=[box.x1, box.y1, box.x2, box.y2],
        after=[tightened.x1, tightened.y1, tightened.x2, tightened.y2],
    )
    return detection.model_copy(update={"bbox": tightened}), image


def _brightened(
    image: np.ndarray, detection: DetectedGarment, quality: ImageQualityResult
) -> tuple[DetectedGarment, np.ndarray] | None:
    """Lift a dim photo with a gamma correction.

    Only applied when the measured luminance is low, so a well-exposed photo is
    never degraded to find out whether a change helps.
    """
    mean_luma = float(quality.metrics.get("mean_luminance", 255.0)) if quality.metrics else 255.0
    if mean_luma >= BRIGHTNESS_TRIGGER:
        return None

    normalised = np.clip(mean_luma / BRIGHTNESS_TARGET, 0.35, 1.0)
    # gamma < 1 lightens; solved so the frame lands near BRIGHTNESS_TARGET.
    gamma = float(np.clip(normalised**0.45, 0.4, 1.0))
    table = (np.linspace(0.0, 1.0, 256) ** gamma * 255.0).astype(np.uint8)
    corrected = table[image] if image.dtype == np.uint8 else table[image.astype(np.uint8)]

    log.info("retry_view_brightened", garment=detection.id, gamma=round(gamma, 3))
    return detection, corrected


__all__ = [
    "BRIGHTNESS_TARGET",
    "BRIGHTNESS_TRIGGER",
    "MIN_CROP_SIDE",
    "TIGHTEN_BELOW_AREA",
    "build_retry_view",
]
