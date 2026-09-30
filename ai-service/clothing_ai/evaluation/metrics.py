"""Scoring, and refusing to score what cannot be scored.

The rules that matter:

* **Unlabelled is not wrong.** An attribute with no ground truth is excluded
  from that attribute's denominator. Counting it as a miss would reward a model
  for being unhelpfully eager, and would let a benchmark look better by having
  fewer labels.
* **Negatives are scored.** A `no_clothing` image that produced an item is a
  false positive, and false positives are the expensive failure here: a user
  uploads a photo of their kitchen and gets a confident "blue t-shirt".
* **Confidence is reported alongside accuracy.** A model that is right 70% of
  the time and says so is more useful than one that is right 85% of the time
  and never admits uncertainty. `calibration` below measures the gap.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from ..common.logging import get_logger
from ..schemas import AnalysisResult, ConfidenceStatus
from .dataset import SCORED_ATTRIBUTES, Annotation

log = get_logger(__name__)

#: Statuses counted as "the pipeline would auto-accept this".
AUTO_ACCEPT: frozenset[ConfidenceStatus] = frozenset(
    {ConfidenceStatus.ACCEPTED, ConfidenceStatus.ACCEPTED_WITH_UNCERTAINTY}
)


@dataclass(slots=True)
class AttributeScore:
    """Per-attribute accuracy, with the denominator kept explicit."""

    name: str
    correct: int = 0
    total: int = 0
    predicted: Counter = field(default_factory=Counter)
    expected: Counter = field(default_factory=Counter)
    pairs: Counter = field(default_factory=Counter)
    unlabelled: int = 0
    withheld: int = 0  # predicted but below the reporting floor

    @property
    def accuracy(self) -> float:
        return self.correct / self.total if self.total else 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "attribute": self.name,
            "correct": self.correct,
            "total": self.total,
            "accuracy": round(self.accuracy, 4),
            "unlabelled_skipped": self.unlabelled,
            "withheld_below_floor": self.withheld,
            "most_confused": [
                {"expected": expected, "predicted": predicted, "count": count}
                for (expected, predicted), count in self.pairs.most_common(10)
            ],
        }


@dataclass(slots=True)
class ItemOutcome:
    annotation_id: str
    correct_attributes: list[str] = field(default_factory=list)
    wrong_attributes: list[str] = field(default_factory=list)
    missing_attributes: list[str] = field(default_factory=list)
    confidence: float = 0.0
    status: str = ""
    needs_review: bool = False
    latency_ms: float = 0.0
    attempts: int = 1
    predicted: dict[str, str | None] = field(default_factory=dict)
    truth: dict[str, str] = field(default_factory=dict)
    failed: bool = False
    failure_reason: str = ""


@dataclass
class EvaluationReport:
    """Everything a reviewer needs, and nothing they cannot act on."""

    total_images: int = 0
    evaluated: int = 0
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (id, reason)

    # Detection
    true_positive: int = 0
    false_positive: int = 0
    false_negative: int = 0

    # Honesty
    rejected_negatives: int = 0
    total_negatives: int = 0
    auto_accepted: int = 0
    needs_review: int = 0
    with_empty_attributes: int = 0

    # Cost
    latencies_ms: list[float] = field(default_factory=list)
    attempts_total: int = 0
    retries: int = 0

    attributes: dict[str, AttributeScore] = field(default_factory=dict)
    outcomes: list[ItemOutcome] = field(default_factory=list)
    model_versions: dict[str, str | None] = field(default_factory=dict)
    dataset_version: int = 1
    scores: dict[str, str | None] = field(default_factory=dict)

    # ------------------------------------------------------------- metrics --

    @property
    def precision(self) -> float:
        denominator = self.true_positive + self.false_positive
        return self.true_positive / denominator if denominator else 0.0

    @property
    def recall(self) -> float:
        denominator = self.true_positive + self.false_negative
        return self.true_positive / denominator if denominator else 0.0

    @property
    def f1(self) -> float:
        if not self.precision or not self.recall:
            return 0.0
        return 2 * self.precision * self.recall / (self.precision + self.recall)

    @property
    def false_positive_rate(self) -> float:
        """Of everything the pipeline offered, how much was wrong."""
        offered = self.true_positive + self.false_positive
        return self.false_positive / offered if offered else 0.0

    @property
    def rejection_rate(self) -> float:
        """Of the deliberate negatives, how many were correctly refused."""
        return (
            self.rejected_negatives / self.total_negatives if self.total_negatives else 1.0
        )

    @property
    def auto_accept_rate(self) -> float:
        return self.auto_accepted / self.evaluated if self.evaluated else 0.0

    @property
    def mean_latency_ms(self) -> float:
        return sum(self.latencies_ms) / len(self.latencies_ms) if self.latencies_ms else 0.0

    @property
    def p95_latency_ms(self) -> float:
        if not self.latencies_ms:
            return 0.0
        ordered = sorted(self.latencies_ms)
        # Nearest-rank; no interpolation, so the number is a latency that was
        # actually observed.
        index = max(0, int(round(0.95 * (len(ordered) - 1))))
        return ordered[index]

    def calibration_error(self, name: str, bins: int = 5) -> float:
        """Mean |stated confidence - observed accuracy| over the items scored.

        Reported per attribute because the pipeline's per-attribute confidences
        are the numbers the client will show. A large gap means the caps in
        `labels.yaml` are wrong, which is a configuration fix, not a model fix.
        """
        buckets: list[list[tuple[float, bool]]] = [[] for _ in range(bins)]
        for outcome in self.outcomes:
            if name not in outcome.correct_attributes and name not in outcome.wrong_attributes:
                continue
            hit = name in outcome.correct_attributes
            for index, bucket in enumerate(buckets):
                low, high = index / bins, (index + 1) / bins
                if low <= outcome.confidence < high or (index == bins - 1 and outcome.confidence == 1.0):
                    bucket.append((outcome.confidence, hit))
                    break

        total = sum(len(bucket) for bucket in buckets)
        if not total:
            return 0.0
        error = 0.0
        for bucket in buckets:
            if not bucket:
                continue
            stated = sum(conf for conf, _ in bucket) / len(bucket)
            observed = sum(1 for _, hit in bucket if hit) / len(bucket)
            error += abs(stated - observed) * (len(bucket) / total)
        return error

    # ------------------------------------------------------------- reporting --

    def to_dict(self) -> dict[str, object]:
        return {
            "dataset_version": self.dataset_version,
            "models": self.model_versions,
            "counts": {
                "total_images": self.total_images,
                "evaluated": self.evaluated,
                "skipped": len(self.skipped),
                "true_positive": self.true_positive,
                "false_positive": self.false_positive,
                "false_negative": self.false_negative,
            },
            "detection": {
                "precision": round(self.precision, 4),
                "recall": round(self.recall, 4),
                "f1": round(self.f1, 4),
                "false_positive_rate": round(self.false_positive_rate, 4),
            },
            "honesty": {
                "negatives": self.total_negatives,
                "correctly_rejected": self.rejected_negatives,
                "rejection_rate": round(self.rejection_rate, 4),
                "auto_accepted": self.auto_accepted,
                "auto_accept_rate": round(self.auto_accept_rate, 4),
                "flagged_for_review": self.needs_review,
                "items_with_no_attributes": self.with_empty_attributes,
            },
            "attributes": {
                name: score.to_dict() for name, score in sorted(self.attributes.items())
            },
            "calibration": {
                name: round(self.calibration_error(name), 4)
                for name in sorted(self.attributes)
            },
            "cost": {
                "mean_latency_ms": round(self.mean_latency_ms, 1),
                "p95_latency_ms": round(self.p95_latency_ms, 1),
                "total_inference_passes": self.attempts_total,
                "items_that_retried": self.retries,
            },
            "skipped": [{"id": i, "reason": r} for i, r in self.skipped],
        }

    def summary(self) -> str:
        lines = [
            f"images            {self.total_images}  (evaluated {self.evaluated}, "
            f"skipped {len(self.skipped)})",
            f"detection         P={self.precision:.3f} R={self.recall:.3f} F1={self.f1:.3f}",
            f"false positives   {self.false_positive}  "
            f"({self.false_positive_rate:.1%} of everything offered)",
            f"negatives         {self.rejected_negatives}/{self.total_negatives} correctly "
            f"refused ({self.rejection_rate:.1%})",
            f"auto-accepted     {self.auto_accepted}/{self.evaluated} "
            f"({self.auto_accept_rate:.1%})",
            "",
            "per-attribute accuracy (unlabelled excluded from the denominator):",
        ]
        for name in SCORED_ATTRIBUTES:
            score = self.attributes.get(name)
            if score is None or not score.total:
                lines.append(f"  {name:<10} no labelled data")
                continue
            lines.append(
                f"  {name:<10} {score.accuracy:6.1%}  ({score.correct}/{score.total}, "
                f"calib err {self.calibration_error(name):.3f})"
            )
        lines += [
            "",
            f"latency           mean {self.mean_latency_ms:.0f} ms, "
            f"p95 {self.p95_latency_ms:.0f} ms",
            f"retries           {self.retries} item(s), "
            f"{self.attempts_total} total inference passes",
        ]
        if self.scores:
            lines += ["", "vocabulary version %s" % self.dataset_version]
        return "\n".join(lines)


def score_attribute(
    name: str,
    truth: str,
    predicted: str | None,
) -> tuple[bool, bool, bool]:
    """Return `(correct, was_labelled, was_predicted)` for one attribute."""
    if truth is None:
        return False, False, predicted is not None
    if predicted is None:
        return False, True, False
    return predicted == truth, True, True


def new_attribute_score(name: str) -> AttributeScore:
    return AttributeScore(name=name)


def record_outcome(
    report: EvaluationReport,
    annotation: Annotation,
    result: AnalysisResult,
) -> None:
    """Score one image into the report."""
    report.total_images += 1

    if annotation.expected.no_clothing:
        report.total_negatives += 1
        if result.items:
            report.false_positive += len(result.items)
            for item in result.items:
                report.outcomes.append(
                    ItemOutcome(
                        annotation_id=annotation.id,
                        failure_reason="false positive on a negative image",
                        confidence=item.confidence,
                        status=item.status.value,
                        latency_ms=float(item.timing_ms.get("total", 0.0)),
                    )
                )
        else:
            report.rejected_negatives += 1
        return

    if not result.items:
        report.false_negative += 1
        report.outcomes.append(
            ItemOutcome(
                annotation_id=annotation.id,
                failure_reason=result.reason or "no item detected",
                failed=True,
                latency_ms=float(result.processing.total_ms or 0.0),
            )
        )
        return

    report.evaluated += 1
    report.latencies_ms.append(float(result.processing.total_ms or 0.0))

    # One image, one garment: the benchmark is single-item by design, so extra
    # detections are counted as false positives rather than silently dropped.
    report.true_positive += 1
    report.false_positive += max(0, len(result.items) - 1)

    item = result.items[0]
    outcome = ItemOutcome(
        annotation_id=annotation.id,
        confidence=item.confidence,
        status=item.status.value,
        needs_review=item.needs_review,
        latency_ms=float(result.processing.total_ms or 0.0),
        attempts=item.attempts,
    )
    report.attempts_total += item.attempts
    if item.attempts > 1:
        report.retries += 1
    if item.status in AUTO_ACCEPT:
        report.auto_accepted += 1
    if item.needs_review:
        report.needs_review += 1

    empty = True
    for name in SCORED_ATTRIBUTES:
        truth = getattr(annotation.expected, name, None)
        score = report.attributes.setdefault(name, new_attribute_score(name))

        if name == "color":
            measured = item.attributes.color
            predicted = measured.primary if measured else None
        else:
            prediction = getattr(item.attributes, name, None)
            predicted = prediction.value if prediction else None

        if truth is None:
            score.unlabelled += 1
            if predicted is not None:
                outcome.predicted[name] = predicted
            continue

        outcome.truth[name] = truth
        if predicted is not None:
            outcome.predicted[name] = predicted
        empty = False

        correct, was_labelled, was_predicted = score_attribute(name, truth, predicted)
        if not was_labelled:
            continue
        score.total += 1
        score.expected[truth] += 1
        if predicted is None:
            score.withheld += 1
        else:
            score.predicted[predicted] += 1
        if correct:
            score.correct += 1
            outcome.correct_attributes.append(name)
        else:
            score.pairs[(truth, predicted or "<none>")] += 1
            outcome.wrong_attributes.append(name)

    if empty:
        report.with_empty_attributes += 1
    report.outcomes.append(outcome)


__all__ = [
    "AUTO_ACCEPT",
    "AttributeScore",
    "EvaluationReport",
    "ItemOutcome",
    "new_attribute_score",
    "record_outcome",
    "score_attribute",
]
