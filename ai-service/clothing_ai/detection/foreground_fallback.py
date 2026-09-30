"""Whole-image fallback for photos the detector misses.

A garment laid flat on a bed, photographed inside a wardrobe, or shot against
a cluttered background routinely produces zero boxes from a Deformable DETR
trained on modelled product shots. Rejecting those outright would throw away
real user photos, so when the primary detector comes back empty we retry once
with a foreground estimate derived from the background border.

This is deliberately a last resort: it always returns at most one box, and it
reports a low `detector_confidence` so the confidence gate knows the garment's
location is a guess rather than a detection.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..common.logging import get_logger
from ..schemas import BoundingBox, DetectedGarment

log = get_logger(__name__)

#: Cap on the reported confidence for a guessed box. Deliberately low: the
#: downstream scorer treats a detection as evidence weighted by this number.
FALLBACK_CONFIDENCE = 0.30


class ForegroundBoxDetector:
    """A `GarmentDetector` that proposes one box around the salient foreground."""

    def __init__(
        self,
        *,
        border_ratio: float = 0.06,
        distance_threshold: float = 30.0,
        min_area_ratio: float = 0.08,
        confidence: float = FALLBACK_CONFIDENCE,
    ) -> None:
        self._border_ratio = border_ratio
        self._distance_threshold = distance_threshold
        self._min_area_ratio = min_area_ratio
        self._confidence = confidence
        self._model_name = "foreground-box/heuristic-v1"

    @property
    def name(self) -> str:
        return self._model_name

    @property
    def labels(self) -> list[str]:
        return ["other"]

    def detect(
        self,
        image: np.ndarray,
        *,
        min_score: float = 0.0,
        nms_iou: float = 0.55,
        max_items: int = 8,
        min_area_ratio: float = 0.0,
        max_area_ratio: float = 1.0,
    ) -> list[DetectedGarment]:
        height, width = image.shape[:2]
        if height < 8 or width < 8:
            return []

        background = self._background_estimate(image)
        distance = np.linalg.norm(
            image.astype(np.float32) - background[None, None, :], axis=2
        )
        foreground = (distance > self._distance_threshold).astype(np.uint8)

        # Close holes, then keep the largest connected component so a single
        # dominant garment is proposed rather than every noisy region.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=2)
        foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel, iterations=1)

        count, labels_map, stats, _ = cv2.connectedComponentsWithStats(foreground, connectivity=8)
        if count <= 1:
            log.info("foreground_fallback", reason="no_component")
            return []

        image_area = float(height * width)
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area = float(stats[largest, cv2.CC_STAT_AREA])
        if area / image_area < self._min_area_ratio:
            log.info("foreground_fallback", reason="component_too_small", ratio=round(area / image_area, 4))
            return []

        x = float(stats[largest, cv2.CC_STAT_LEFT])
        y = float(stats[largest, cv2.CC_STAT_TOP])
        w = float(stats[largest, cv2.CC_STAT_WIDTH])
        h = float(stats[largest, cv2.CC_STAT_HEIGHT])

        # Reject frames where "foreground" is essentially the whole picture;
        # that means the background estimate failed, not that we found a garment.
        if (w * h) / image_area > 0.97:
            log.info("foreground_fallback", reason="foreground_fills_frame")
            return []

        log.info("foreground_fallback", reason="used", area_ratio=round(area / image_area, 4))
        return [
            DetectedGarment(
                id="garment_001",
                coarse_label="other",
                bbox=BoundingBox(x1=x, y1=y, x2=x + w, y2=y + h),
                detector_confidence=self._confidence,
                model=self._model_name,
                extras={"image_area": image_area, "foreground_ratio": area / image_area},
            )
        ]

    def _background_estimate(self, image: np.ndarray) -> np.ndarray:
        height, width = image.shape[:2]
        band = max(1, int(min(height, width) * self._border_ratio))
        border = np.concatenate(
            [
                image[:band].reshape(-1, 3),
                image[-band:].reshape(-1, 3),
                image[:, :band].reshape(-1, 3),
                image[:, -band:].reshape(-1, 3),
            ]
        ).astype(np.float32)
        return np.median(border, axis=0)
