"""Stage 2 — garment detection.

The interface is deliberately narrow so a custom, fashion-trained detector can
be dropped in later. Everything downstream consumes `DetectedGarment` and
never learns which detector produced it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from ..schemas import DetectedGarment


@runtime_checkable
class GarmentDetector(Protocol):
    """Locate individual clothing items in an image.

    Contract:

    * return an empty list when nothing garment-like is present — this is the
      gate that stops a bottle from being labelled a t-shirt;
    * boxes are in pixels of the image passed in;
    * `coarse_label` is the detector's own vocabulary, not the final category.
    """

    @property
    def name(self) -> str:
        """Stable identifier reported in `AnalysisResult.models`."""
        ...

    @property
    def labels(self) -> list[str]:
        """The detector's native label vocabulary."""
        ...

    def detect(
        self,
        image: np.ndarray,
        *,
        min_score: float = 0.35,
        nms_iou: float = 0.55,
        max_items: int = 8,
        min_area_ratio: float = 0.006,
        max_area_ratio: float = 0.98,
    ) -> list[DetectedGarment]:
        """Return every garment found, largest and most confident first."""
        ...
