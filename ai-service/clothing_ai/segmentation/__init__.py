"""Stage 3 — garment segmentation."""

from typing import Any

from .base import GarmentSegmenter
from .sam2 import Sam2Segmenter


def build_segmenter(handle: Any) -> GarmentSegmenter:
    """Factory for the shipped segmenter. Swap here to change segmenters."""
    return Sam2Segmenter(handle)


__all__ = ["GarmentSegmenter", "Sam2Segmenter", "build_segmenter"]
