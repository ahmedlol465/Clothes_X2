"""Runs the pipeline over a labelled set and reports what it got wrong.

The point of this phase is not a pretty number. It is a list of specific,
reproducible failures that says what to change next — and it is honest about
the cases where the pipeline declined to answer, because a refusal is a
different outcome from a mistake and only one of them is worth optimising away.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

from ..common.logging import get_logger
from ..config.settings import Settings, get_settings
from ..schemas import AnalysisOptions, AnalysisResult
from .dataset import Dataset, load_dataset
from .metrics import EvaluationReport, ItemOutcome, record_outcome

log = get_logger(__name__)

#: Per-image failures recorded here instead of aborting the run. A benchmark
#: that stops at the first bad image reports nothing useful.
RECOVERABLE = (OSError, ValueError, RuntimeError)


def evaluate(
    dataset: Dataset | Path | str,
    pipeline: object = None,
    *,
    settings: Settings | None = None,
    options: AnalysisOptions | None = None,
    on_result: Callable[[str, AnalysisResult], None] | None = None,
    limit: int | None = None,
) -> EvaluationReport:
    """Score `pipeline` over `dataset` and return a report.

    `pipeline` may be omitted to build the real one, which means loading every
    model. Tests and dry runs pass a stub instead.
    """
    settings = settings or get_settings()
    if not isinstance(dataset, Dataset):
        dataset = load_dataset(dataset)

    if pipeline is None:
        from ..factory import build_default_components
        from ..pipeline import ClothingAnalysisPipeline

        pipeline = ClothingAnalysisPipeline(build_default_components(settings=settings))

    options = options or AnalysisOptions(include_embedding=False, include_mask=False)
    report = EvaluationReport(
        dataset_version=dataset.version,
        model_versions=_versions(pipeline),
    )

    annotations = dataset.images[:limit] if limit else dataset.images
    for annotation in annotations:
        path = dataset.resolve(annotation)
        if not path.exists():
            report.skipped.append((annotation.id, f"image not found: {path}"))
            continue
        try:
            payload = path.read_bytes()
        except OSError as exc:
            report.skipped.append((annotation.id, f"unreadable: {exc}"))
            continue

        started = time.perf_counter()
        try:
            result = pipeline.analyze(payload, options=options, request_id=annotation.id)
        except RECOVERABLE as exc:
            # Recorded as a failure, not raised: one broken image must not cost
            # the whole benchmark.
            report.total_images += 1
            report.false_negative += 1
            report.outcomes.append(
                ItemOutcome(
                    annotation_id=annotation.id,
                    failed=True,
                    failure_reason=f"{type(exc).__name__}: {exc}",
                    latency_ms=(time.perf_counter() - started) * 1000.0,
                )
            )
            log.warning("evaluation_image_failed", image=annotation.id, error=str(exc))
            continue

        record_outcome(report, annotation, result)
        if on_result is not None:
            on_result(annotation.id, result)

    log.info(
        "evaluation_complete",
        images=report.total_images,
        evaluated=report.evaluated,
        f1=round(report.f1, 4),
    )
    return report


def _versions(pipeline: object) -> dict[str, str | None]:
    try:
        models = pipeline._model_versions()  # noqa: SLF001 - reporting, same package
    except Exception:  # pragma: no cover - a stub may not implement it
        return {}
    return models.model_dump()


def error_analysis(report: EvaluationReport, limit: int = 25) -> dict[str, object]:
    """Group failures into causes that suggest distinct fixes.

    The categories are chosen so each one implies a different action: a
    detector problem, a vocabulary problem, a mask problem and an over-confident
    problem are fixed in four different places.
    """
    buckets: dict[str, list[dict[str, object]]] = {
        "detector_missed_garment": [],
        "detector_found_something_in_a_non_garment": [],
        "wrong_category": [],
        "wrong_colour": [],
        "wrong_pattern": [],
        "wrong_style": [],
        "wrong_material": [],
        "abstained_on_a_garment": [],
        "over_confident": [],
        "under_confident": [],
        "crashed": [],
    }

    for outcome in report.outcomes:
        entry: dict[str, object] = {"id": outcome.annotation_id}

        if outcome.failure_reason.startswith(("OSError", "ValueError", "RuntimeError")):
            buckets["crashed"].append({**entry, "reason": outcome.failure_reason})
            continue
        if outcome.failed:
            buckets["detector_missed_garment"].append(
                {**entry, "reason": outcome.failure_reason}
            )
            continue
        if "false positive" in outcome.failure_reason:
            buckets["detector_found_something_in_a_non_garment"].append(
                {**entry, "reason": outcome.failure_reason}
            )
            continue

        entry["confidence"] = round(outcome.confidence, 3)
        entry["status"] = outcome.status

        for name in ("category", "color", "pattern", "style", "material"):
            if name in outcome.wrong_attributes:
                bucket = buckets[f"wrong_{name}"]
                bucket.append(
                    {
                        **entry,
                        "expected": outcome.truth.get(name),
                        "predicted": outcome.predicted.get(name, "<withheld>"),
                    }
                )
                break
        else:
            if not outcome.correct_attributes:
                buckets["abstained_on_a_garment"].append(entry)

        # Calibration: a wrong answer given confidently is the expensive one.
        if outcome.wrong_attributes and not outcome.needs_review and outcome.confidence > 0.7:
            buckets["over_confident"].append(entry)
        elif outcome.correct_attributes and outcome.needs_review:
            buckets["under_confident"].append(entry)

    return {
        "counts": {name: len(items) for name, items in buckets.items()},
        "examples": {
            name: items[:limit]
            for name, items in buckets.items()
            if items
        },
        "suggested_next_steps": _suggest(buckets),
    }


def _suggest(buckets: dict[str, list[dict[str, object]]]) -> list[str]:
    """Turn counts into concrete, ordered advice."""
    advice: list[str] = []
    counts = {name: len(items) for name, items in buckets.items()}

    if counts["detector_found_something_in_a_non_garment"]:
        advice.append(
            "The detector is firing on non-garments. Raise `detector_min_score` in "
            "labels.yaml, or tighten `detector_min_area_ratio`. These are the most "
            "visible failures to a user, so fix them first."
        )
    if counts["crashed"]:
        advice.append(
            "Some images raised instead of returning a result. Every stage is meant to "
            "degrade rather than throw; find the traceback in the logs."
        )
    if counts["detector_missed_garment"]:
        advice.append(
            "Garments the detector missed. Check `detector_min_score` downwards and "
            "confirm the photo quality gate is not rejecting them first."
        )
    if counts["wrong_category"]:
        advice.append(
            "Category errors: check `category.by_group` in labels.yaml — a group that "
            "is too broad cannot discriminate, and a too-narrow one moves the error "
            "into the gate."
        )
    if counts["wrong_colour"]:
        advice.append(
            "Colour errors: check the LAB anchors in `color/palette.py` against the "
            "tones actually in the photos, and check whether the mask is including "
            "background."
        )
    if counts["over_confident"]:
        advice.append(
            "Confident wrong answers. Lower the relevant `confidence_cap` in "
            "labels.yaml, or tighten a validation rule so the scorer sees the conflict."
        )
    if counts["under_confident"]:
        advice.append(
            "Correct answers that were flagged for review. This is the safe direction "
            "to err in; only act on it if the review queue is a real burden."
        )
    if counts["abstained_on_a_garment"]:
        advice.append(
            "Garments where nothing was asserted. Check `report_floor` and whether the "
            "per-attribute caps are set so low that real values fall beneath it."
        )
    if not advice:
        advice.append("No failure pattern stands out. Add more labelled images.")
    return advice


def confusion_matrix(
    report: EvaluationReport, attribute: str
) -> dict[str, dict[str, int]]:
    """Expected-by-predicted counts, for eyeballing which pairs collide."""
    matrix: dict[str, dict[str, int]] = {}
    for outcome in report.outcomes:
        truth = outcome.truth.get(attribute)
        if truth is None:
            continue
        predicted = outcome.predicted.get(attribute, "<withheld>")
        matrix.setdefault(truth, {})
        matrix[truth][predicted] = matrix[truth].get(predicted, 0) + 1
    return matrix


__all__ = ["confusion_matrix", "error_analysis", "evaluate"]
