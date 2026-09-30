"""Stage 7 — confidence scoring and the retry gate."""

from .scoring import (
    ATTRIBUTE_WEIGHTS,
    ENTROPY_GUARD,
    MARGIN_GUARD,
    USABLE_SEGMENTATION,
    ScoredAttributes,
    apply_segmentation_quality,
    classify_status,
    fuse,
    needs_review,
    reportable,
    should_retry,
)

__all__ = [
    "ATTRIBUTE_WEIGHTS",
    "ENTROPY_GUARD",
    "MARGIN_GUARD",
    "USABLE_SEGMENTATION",
    "ScoredAttributes",
    "apply_segmentation_quality",
    "classify_status",
    "fuse",
    "needs_review",
    "reportable",
    "should_retry",
]
