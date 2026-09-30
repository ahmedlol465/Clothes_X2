"""Stage 4b — fashion attribute classification."""

from .zero_shot import (
    LOGIT_SCALE,
    SecondaryClassifier,
    ZeroShotClassifier,
    ZeroShotResult,
    softmax_confidence,
)

__all__ = [
    "LOGIT_SCALE",
    "SecondaryClassifier",
    "ZeroShotClassifier",
    "ZeroShotResult",
    "softmax_confidence",
]
