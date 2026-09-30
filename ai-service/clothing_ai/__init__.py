"""Clothing attribute analysis.

One call is enough for most callers:

    from clothing_ai import analyze
    result = analyze("photo.jpg")

The pipeline is built once and reused, because loading the detector, the
segmenter and the embedding model costs seconds and a service that reloads them
per call is a service nobody can afford to call.

Attributes are resolved lazily (PEP 562). Importing `clothing_ai` therefore does
not drag in OpenCV, torch and the transformers stack; that only happens if the
caller actually touches the pipeline.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

__version__ = "0.1.0"

if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from .config.settings import Settings
    from .schemas import AnalysisOptions, AnalysisResult

__all__ = [
    "__version__",
    "analyze",
    "analyze_bytes",
    "clear_pipeline",
    "get_pipeline",
]


#: Process-wide pipeline. Loading the models is the expensive part, and nothing
#: about it is per-request, so it is shared deliberately rather than cached by
#: accident.
_PIPELINE: Any = None


def get_pipeline(settings: "Settings | None" = None) -> Any:
    """Return the shared pipeline, building it on first use."""
    global _PIPELINE
    if _PIPELINE is None:
        from .factory import build_default_components
        from .pipeline import ClothingAnalysisPipeline

        # Settings travel inside the components, not as a separate argument.
        _PIPELINE = ClothingAnalysisPipeline(build_default_components(settings=settings))
    return _PIPELINE


def clear_pipeline() -> None:
    """Drop the cached pipeline and release its models."""
    global _PIPELINE
    if _PIPELINE is not None:
        release = getattr(_PIPELINE, "close", None)
        if callable(release):
            release()
    _PIPELINE = None


def analyze_bytes(
    payload: bytes,
    *,
    options: "AnalysisOptions | None" = None,
    request_id: str | None = None,
    settings: "Settings | None" = None,
) -> "AnalysisResult":
    """Analyze already-encoded image bytes."""
    return get_pipeline(settings).analyze(
        payload, options=options, request_id=request_id
    )


def analyze(
    image: "str | Path | bytes",
    *,
    options: "AnalysisOptions | None" = None,
    request_id: str | None = None,
    settings: "Settings | None" = None,
) -> "AnalysisResult":
    """Analyze a garment photo.

    `image` is a filesystem path or the encoded bytes of a JPEG/PNG/WebP — the
    two forms a caller actually has. The result reports what was found together
    with a per-attribute confidence, and never asserts an attribute it could not
    support: see `AnalysisResult` and `ConfidenceStatus` for how to read it.
    """
    if isinstance(image, (str, Path)):
        payload = Path(image).read_bytes()
    elif isinstance(image, (bytes, bytearray, memoryview)):
        payload = bytes(image)
    else:
        raise TypeError(
            "analyze() takes a path or encoded image bytes, got "
            f"{type(image).__name__}. Encode the image first, or use "
            "analyze_bytes()."
        )
    return analyze_bytes(
        payload, options=options, request_id=request_id, settings=settings
    )


_LAZY_SCHEMAS = frozenset(
    {
        "AnalysisResult",
        "AnalysisOptions",
        "ConfidenceStatus",
        "GarmentAnalysis",
        "ImageQualityResult",
    }
)


def __getattr__(name: str) -> Any:
    """Expose the common schema names lazily.

    `from clothing_ai import AnalysisResult` reads naturally, and typing the
    return value should not force a full import of the inference stack.
    """
    if name in _LAZY_SCHEMAS:
        from . import schemas

        return getattr(schemas, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    # Without this the lazily-resolved names are invisible to `dir()`, tab
    # completion and `from clothing_ai import *`.
    return sorted(set(globals()) | _LAZY_SCHEMAS)
