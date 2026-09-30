"""End-to-end run against real weights.

Not part of the test suite: it is a smoke check whose output is meant to be read,
not asserted. Run it once the cache is warm.

    python -m scripts.smoke_real

Prints the full response so the honest failures stay visible: a run that finds
nothing, a run that reports low confidence, and a run that takes eight seconds are
all useful information, and a test that asserted "garment found" would only hide
the last two.
"""

from __future__ import annotations

import sys
import time

import cv2
import numpy as np

from clothing_ai.config.settings import Settings, configure_torch_cache


def synthetic_photo() -> np.ndarray:
    """A stand-in for a photo, since no sample images are committed."""
    image = np.full((720, 900, 3), 235, np.uint8)  # near-white backdrop
    body = np.array([70, 90, 205], np.uint8)  # RGB blue
    cv2.rectangle(image, (300, 160), (600, 640), body.tolist(), -1)  # torso
    cv2.rectangle(image, (250, 180), (300, 380), body.tolist(), -1)  # left sleeve
    cv2.rectangle(image, (600, 180), (650, 380), body.tolist(), -1)  # right sleeve
    return image


def main() -> int:
    configure_torch_cache()
    settings = Settings(_env_file=None)

    from clothing_ai.pipeline import build_pipeline

    started = time.perf_counter()
    pipeline = build_pipeline(settings=settings)
    print(f"models loaded in {time.perf_counter() - started:.1f}s on {settings.device}")

    # `analyze` takes encoded bytes, exactly as the HTTP layer receives them, so
    # the decode path is part of what this exercises. PIL is used rather than
    # `cv2.imencode` because the synthetic image is built in RGB and OpenCV's
    # encoder assumes BGR — a swap here silently recolours the test subject.
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.fromarray(synthetic_photo(), mode="RGB").save(buffer, format="JPEG", quality=95)

    started = time.perf_counter()
    result = pipeline.analyze(buffer.getvalue())
    elapsed = time.perf_counter() - started

    print(f"\ninference: {elapsed:.1f}s")
    print(f"success  : {result.success}")
    if result.reason:
        print(f"reason   : {result.reason}")
    for issue in result.image_quality.issues:
        print(f"quality  : {issue.code} {issue.message}")
    print(f"garments : {len(result.items)}")
    for item in result.items:
        print(
            f"  {item.id} {item.coarse_label} conf={item.confidence:.2f} "
            f"status={item.status.value} attempts={item.attempts}"
        )
        attrs = item.attributes
        print(f"    category   : {_pred(attrs.category)}")
        print(f"    color      : {_color(attrs.color)}")
        print(f"    material   : {_pred(attrs.material)}")
        print(f"    pattern    : {_pred(attrs.pattern)}")
        print(f"    style      : {_pred(attrs.style)}")
        print(f"    subcategory: {_pred(attrs.subcategory)}")
        print(f"    seg quality: {item.segmentation_quality}")
        print(f"    embedding  : {_dims(item.embedding)}")
        print(f"    review     : needs_review={item.needs_review} {item.review_reason}")
        for rule in (item.validation.rules if item.validation else []):
            mark = "ok  " if rule.passed else "FAIL"
            print(f"    validation : [{mark}] {rule.code}: {rule.detail}")
        if item.validation and item.validation.flags:
            print(f"    flags      : {item.validation.flags}")
    processing = result.processing
    print(
        "timings  : "
        + " ".join(
            f"{name.removesuffix('_ms')}={getattr(processing, name):.0f}ms"
            for name in (
                "decode_ms",
                "quality_ms",
                "detection_ms",
                "segmentation_ms",
                "classification_ms",
                "color_ms",
                "embeddings_ms",
                "total_ms",
            )
        )
    )
    print(f"models   : {result.models.detector} / {result.models.segmenter}")
    return 0


def _pred(prediction) -> str:
    if prediction is None:
        return "None (absent, not guessed)"
    return f"{prediction.value} conf={prediction.confidence:.2f} src={prediction.source}"


def _color(result) -> str:
    if result is None:
        return "None (absent, not guessed)"
    text = f"{result.primary} #{result.primary_hex}"
    if result.secondary:
        text += f" secondary={result.secondary}"
    if result.is_multicolor:
        text += " (multicolor)"
    # ColorResult carries no confidence of its own; the palette is a
    # measurement, and the item's blended `confidence` is what reflects it.
    return text


def _dims(embedding) -> str:
    return "absent" if not embedding else f"{len(embedding)} floats"


if __name__ == "__main__":
    sys.exit(main())
