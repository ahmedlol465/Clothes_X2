"""Detector composition: a primary detector plus an opt-in fallback.

`with_fallback` is the default. `strict` is what a benchmark should use when
measuring detection quality, because the fallback would otherwise paper over
the detector's real recall.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from ..common.logging import get_logger
from ..schemas import DetectedGarment
from .base import GarmentDetector
from .foreground_fallback import ForegroundBoxDetector

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class DetectorConfig:
    min_score: float
    nms_iou: float
    max_items: int
    min_area_ratio: float
    max_area_ratio: float
    enable_fallback: bool


class FallbackDetector:
    """Run `primary`; only if it finds nothing, consult `fallback`."""

    def __init__(
        self,
        primary: GarmentDetector,
        fallback: GarmentDetector,
        *,
        config: DetectorConfig,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._config = config

    @property
    def name(self) -> str:
        return f"{self._primary.name}|fallback:{self._fallback.name}"

    @property
    def labels(self) -> list[str]:
        return self._primary.labels

    def detect(self, image: np.ndarray, **overrides: Any) -> list[DetectedGarment]:
        config = self._config
        kwargs = {
            "min_score": overrides.get("min_score", config.min_score),
            "nms_iou": overrides.get("nms_iou", config.nms_iou),
            "max_items": overrides.get("max_items", config.max_items),
            "min_area_ratio": overrides.get("min_area_ratio", config.min_area_ratio),
            "max_area_ratio": overrides.get("max_area_ratio", config.max_area_ratio),
        }
        found = self._primary.detect(image, **kwargs)
        if found or not config.enable_fallback:
            return found

        # The fallback never proposes more than one box, and only when the
        # request is for a single item.
        kwargs["min_area_ratio"] = max(kwargs["min_area_ratio"], 0.08)
        recovered = self._fallback.detect(image, **kwargs)
        if recovered:
            log.info(
                "detector_fallback_used",
                primary=self._primary.name,
                fallback=self._fallback.name,
            )
        return recovered


def build_detector(
    handle: Any,
    *,
    config: DetectorConfig,
) -> GarmentDetector:
    """Factory for the shipped detector. Swap here to change detectors."""
    from .fashion_detr import FashionDeformableDetrDetector

    primary = FashionDeformableDetrDetector(handle)
    if not config.enable_fallback:
        return primary
    return FallbackDetector(primary, ForegroundBoxDetector(), config=config)
