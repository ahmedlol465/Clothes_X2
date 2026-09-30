"""Stage 3 — garment segmentation.

A mask is what makes colour extraction trustworthy: without it, KMeans is
clustering the background too. The mask also removes the scene from the
embedding, which is what lets a photo of the same jacket in two rooms produce
near-identical vectors.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from ..schemas import DetectedGarment, SegmentationResult


@runtime_checkable
class GarmentSegmenter(Protocol):
    """Turn a detection into a binary mask."""

    @property
    def name(self) -> str:
        ...

    def segment(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        *,
        quality_floor: float = 0.0,
    ) -> SegmentationResult | None:
        """Return a mask, or `None` when segmentation is not usable."""
        ...
