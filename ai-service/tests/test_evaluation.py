"""Tests for the benchmark itself.

A benchmark that cannot be shown to be wrong is decoration. These check the
accounting rules: unlabelled attributes are excluded rather than counted as
misses, deliberate negatives are scored as false positives when the pipeline
answers them, and a crash on one image does not end the run.
"""

from __future__ import annotations

import json

import pytest

from clothing_ai.evaluation import (
    AttributeScore,
    Dataset,
    EvaluationReport,
    confusion_matrix,
    error_analysis,
    evaluate,
    load_dataset,
    record_outcome,
    save_dataset,
    score_attribute,
)
from clothing_ai.schemas import AnalysisOptions, AnalysisResult, ConfidenceStatus

from stubs import encode_garment_png


def write_dataset(tmp_path, rows) -> Dataset:
    """Write a dataset plus real PNGs, and return the loaded Dataset."""
    images = []
    for index, row in enumerate(rows):
        name = f"img-{index:03d}.png"
        path = tmp_path / name
        if row.get("write_image", True):
            garment = row.get("garment", (30, 60, 120))
            path.write_bytes(encode_garment_png(garment=garment))
        images.append(
            {
                "id": row.get("id", f"img-{index:03d}"),
                "file": name,
                "split": row.get("split", "val"),
                "coarse_label": row.get("coarse_label", "top"),
                "expected": row.get("expected", {}),
            }
        )
    annotation = tmp_path / "annotations" / "bench.json"
    annotation.parent.mkdir(parents=True, exist_ok=True)
    annotation.write_text(
        json.dumps({"version": 1, "images": images}, ensure_ascii=False), encoding="utf-8"
    )
    return load_dataset(annotation)


# ------------------------------------------------------------------ scoring --


class TestScoringRules:
    def test_an_unlabelled_attribute_is_not_a_miss(self):
        """The denominator must not grow for attributes nobody labelled."""
        report = EvaluationReport()
        score = AttributeScore(name="category")
        score.total = 2
        score.correct = 2
        assert score.accuracy == 1.0
        # `unlabelled` is tracked but never enters `total`.
        score.unlabelled = 40
        assert score.accuracy == 1.0
        assert score.to_dict()["unlabelled_skipped"] == 40

    def test_absence_of_a_label_reads_as_unlabelled_not_wrong(self):
        assert score_attribute("color", None, "blue") == (False, False, True)
        assert score_attribute("color", None, None) == (False, False, False)

    def test_a_wrong_answer_scores_as_wrong(self):
        assert score_attribute("color", "red", "blue") == (False, True, True)
        assert score_attribute("color", "red", None) == (False, True, False)

    def test_a_withheld_prediction_counts_against_accuracy(self):
        """Declining to answer on a labelled image is not a free pass."""
        score = AttributeScore(name="style", total=1, correct=0, withheld=1)
        assert score.accuracy == 0.0
        assert score.to_dict()["withheld_below_floor"] == 1


# ------------------------------------------------------------------ dataset --


class TestDataset:
    def test_it_loads_images_and_resolves_paths_against_the_annotations_dir(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        assert len(dataset) == 1
        assert dataset.resolve(dataset.images[0]).exists()
        assert dataset.missing_files() == []

    def test_it_reports_missing_images_rather_than_skipping_them(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        (tmp_path / "img-000.png").unlink()
        assert dataset.missing_files() == ["img-000.png"]

    def test_it_rejects_duplicate_ids(self, tmp_path):
        path = tmp_path / "bench.json"
        path.write_text(
            json.dumps(
                {
                    "images": [
                        {"id": "same", "file": "a.png"},
                        {"id": "same", "file": "b.png"},
                    ]
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="duplicate"):
            load_dataset(path)

    def test_it_rejects_an_unknown_split(self, tmp_path):
        path = tmp_path / "bench.json"
        path.write_text(
            json.dumps({"images": [{"id": "a", "file": "a.png", "split": "holdout"}]}),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="split"):
            load_dataset(path)

    def test_it_round_trips(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [{"id": "a", "expected": {"category": "t-shirt", "color": None}}],
        )
        out = tmp_path / "copy.json"
        save_dataset(dataset, out)
        reloaded = load_dataset(out)
        assert reloaded.images[0].expected.category == "t-shirt"
        assert reloaded.images[0].expected.color is None

    def test_splits_partition_the_set(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "split": "val"},
                {"id": "b", "split": "test"},
                {"id": "c", "split": "val"},
            ],
        )
        assert [i.id for i in dataset.by_split("val")] == ["a", "c"]
        assert [i.id for i in dataset.by_split("test")] == ["b"]


# ----------------------------------------------------------------- evaluate --


class StubPipeline:
    """A pipeline that returns canned results, so the harness itself is tested."""

    def __init__(self, results):
        self._results = dict(results)
        self.calls: list[str] = []

    def analyze(self, payload, *, options=None, request_id=None):
        self.calls.append(request_id)
        canned = self._results.get(request_id)
        if isinstance(canned, Exception):
            raise canned
        return canned

    def _model_versions(self):
        from clothing_ai.schemas import ModelVersions

        return ModelVersions(
            detector="stub-detector",
            segmenter="stub-segmenter",
            classifier="stub-classifier",
            embedder="stub-embedder",
        )


def _result(item=None, reason=None, total_ms=12.0):
    from clothing_ai.schemas import ImageQualityResult, StageTiming

    return AnalysisResult(
        success=item is not None,
        items=[item] if item else [],
        reason=reason,
        image_quality=ImageQualityResult(score=0.9, usable=True),
        processing=StageTiming(total_ms=total_ms),
    )


def _item(
    category="t-shirt",
    color="blue",
    confidence=0.8,
    status=None,
    attempts=1,
    needs_review=False,
):
    from clothing_ai.schemas import (
        AttributePrediction,
        BoundingBox,
        ColorResult,
        GarmentAnalysis,
        GarmentAttributes,
    )

    return GarmentAnalysis(
        id="g1",
        bbox=BoundingBox(x1=0.1, y1=0.1, x2=0.9, y2=0.9),
        coarse_label="top",
        attributes=GarmentAttributes(
            category=AttributePrediction(value=category, confidence=0.9, source="test"),
            color=ColorResult(
                primary=color, primary_hex="#1e3c78", distribution={color: 1.0}
            ),
        ),
        confidence=confidence,
        status=status or ConfidenceStatus.ACCEPTED,
        needs_review=needs_review,
        attempts=attempts,
    )


class TestEvaluate:
    def test_it_scores_labelled_attributes(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt", "color": "blue"}},
                {"id": "b", "expected": {"category": "dress", "color": "red"}},
            ],
        )
        pipeline = StubPipeline(
            {
                "a": _result(_item(category="t-shirt", color="blue")),
                "b": _result(_item(category="dress", color="red")),
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.evaluated == 2
        assert report.true_positive == 2
        assert report.false_positive == 0
        assert report.attributes["category"].accuracy == 1.0
        assert report.attributes["color"].accuracy == 1.0

    def test_an_unlabelled_attribute_is_skipped_not_missed(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [{"id": "a", "expected": {"category": "t-shirt"}}],  # no colour label
            )
        pipeline = StubPipeline(
            {"a": _result(_item(category="t-shirt", color="blue"))}
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.attributes["color"].total == 0
        assert report.attributes["color"].unlabelled == 1
        assert report.attributes["category"].total == 1

    def test_a_missed_garment_is_a_false_negative_not_an_error(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        pipeline = StubPipeline(
            {"a": _result(None, reason="no clothing detected", total_ms=5.0)}
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.evaluated == 0
        assert report.false_negative == 1
        assert report.false_positive == 0
        # A refusal must not count against the rejection rate of negatives.
        assert report.total_negatives == 0

    def test_a_negative_the_pipeline_answers_is_a_false_positive(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {
                    "id": "a",
                    "expected": {"no_clothing": True},
                    "garment": (200, 200, 200),
                }
            ],
        )
        pipeline = StubPipeline({"a": _result(_item())})
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.total_negatives == 1
        assert report.rejected_negatives == 0
        assert report.false_positive == 1
        assert report.rejection_rate == 0.0

    def test_a_correctly_refused_negative_counts_as_a_rejection(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"no_clothing": True}}]
        )
        pipeline = StubPipeline(
            {"a": _result(None, reason="no clothing detected")}
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.rejected_negatives == 1
        assert report.rejection_rate == 1.0
        assert report.false_positive == 0

    def test_one_broken_image_does_not_end_the_run(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt"}},
                {"id": "b", "expected": {"category": "dress"}},
            ],
        )
        pipeline = StubPipeline(
            {
                "a": RuntimeError("decoder exploded"),
                "b": _result(_item(category="dress", color="red")),
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert pipeline.calls == ["a", "b"]
        assert report.evaluated == 1
        assert report.attributes["category"].accuracy == 1.0
        crashed = [o for o in report.outcomes if o.failure_reason.startswith("RuntimeError")]
        assert len(crashed) == 1

    def test_a_missing_file_is_skipped_with_a_reason(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        (tmp_path / "img-000.png").unlink()
        pipeline = StubPipeline({})
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert pipeline.calls == []
        assert len(report.skipped) == 1
        assert "not found" in report.skipped[0][1]

    def test_extra_detections_count_as_false_positives(self, tmp_path):
        """The benchmark is single-item; a second detection is not free."""
        from clothing_ai.schemas import ImageQualityResult, StageTiming

        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        two_items = AnalysisResult(
            success=True,
            items=[_item(category="t-shirt"), _item(category="dress")],
            image_quality=ImageQualityResult(score=0.9, usable=True),
            processing=StageTiming(total_ms=9.0),
        )
        report = evaluate(
            dataset, StubPipeline({"a": two_items}), options=AnalysisOptions()
        )

        assert report.true_positive == 1
        assert report.false_positive == 1
        assert report.false_positive_rate == 0.5

    def test_it_records_retries_and_latency(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        pipeline = StubPipeline(
            {
                "a": _result(
                    _item(category="t-shirt", color="blue", attempts=2),
                    total_ms=40.0,
                )
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())

        assert report.retries == 1
        assert report.attempts_total == 2
        assert report.mean_latency_ms == 40.0
        assert report.p95_latency_ms == 40.0

    def test_it_captures_model_versions(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        report = evaluate(
            dataset,
            StubPipeline({"a": _result(_item(category="t-shirt"))}),
            options=AnalysisOptions(),
        )
        assert report.model_versions["detector"] == "stub-detector"

    def test_auto_accept_rate_reflects_the_status(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt"}},
                {"id": "b", "expected": {"category": "dress"}},
            ],
        )
        pipeline = StubPipeline(
            {
                "a": _result(_item(category="t-shirt", status=ConfidenceStatus.ACCEPTED)),
                "b": _result(
                    _item(
                        category="dress",
                        color="red",
                        status=ConfidenceStatus.ACCEPTED_WITH_UNCERTAINTY,
                    )
                ),
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())
        assert report.auto_accepted == 2
        assert report.auto_accept_rate == 1.0


# ------------------------------------------------------------ error analysis --


class TestErrorAnalysis:
    def test_a_wrong_category_is_named_as_such(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "dress"}}]
        )
        pipeline = StubPipeline(
            {"a": _result(_item(category="t-shirt", color="blue"))}
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())
        analysis = error_analysis(report)

        assert analysis["counts"]["wrong_category"] == 1
        example = analysis["examples"]["wrong_category"][0]
        assert example["expected"] == "dress"
        assert example["predicted"] == "t-shirt"

    def test_a_confident_mistake_is_flagged_as_overconfidence(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "dress"}}]
        )
        pipeline = StubPipeline(
            {
                "a": _result(
                    _item(
                        category="t-shirt",
                        color="blue",
                        confidence=0.92,
                        needs_review=False,
                    )
                )
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())
        assert error_analysis(report)["counts"]["over_confident"] == 1

    def test_a_flagged_correct_answer_is_underconfidence_not_a_mistake(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        pipeline = StubPipeline(
            {
                "a": _result(
                    _item(
                        category="t-shirt",
                        color="blue",
                        confidence=0.4,
                        needs_review=True,
                    )
                )
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())
        analysis = error_analysis(report)

        assert analysis["counts"]["under_confident"] == 1
        assert analysis["counts"]["wrong_category"] == 0

    def test_it_names_a_false_positive_on_a_negative(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"no_clothing": True}}]
        )
        report = evaluate(
            dataset,
            StubPipeline({"a": _result(_item())}),
            options=AnalysisOptions(),
        )
        analysis = error_analysis(report)
        assert analysis["counts"]["detector_found_something_in_a_non_garment"] == 1
        assert any(
            "detector_min_score" in advice
            for advice in analysis["suggested_next_steps"]
        )

    def test_a_clean_run_advises_labelling_more_images(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt", "color": "blue"}}]
        )
        report = evaluate(
            dataset,
            StubPipeline({"a": _result(_item(category="t-shirt", color="blue"))}),
            options=AnalysisOptions(),
        )
        analysis = error_analysis(report)
        assert analysis["suggested_next_steps"] == [
            "No failure pattern stands out. Add more labelled images."
        ]

    def test_confusion_matrix_only_covers_labelled_attributes(self, tmp_path):
        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt"}},
                {"id": "b", "expected": {"category": "dress"}},
                {"id": "c", "expected": {"category": "dress"}},
            ],
        )
        pipeline = StubPipeline(
            {
                "a": _result(_item(category="t-shirt", color="blue")),
                "b": _result(_item(category="t-shirt", color="blue")),
                "c": _result(_item(category="dress", color="red")),
            }
        )
        report = evaluate(dataset, pipeline, options=AnalysisOptions())
        matrix = confusion_matrix(report, "category")

        assert matrix == {
            "t-shirt": {"t-shirt": 1},
            "dress": {"t-shirt": 1, "dress": 1},
        }


# ---------------------------------------------------------------- reporting --


class TestReporting:
    def test_the_report_is_json_serialisable(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        report = evaluate(
            dataset,
            StubPipeline({"a": _result(_item(category="t-shirt"))}),
            options=AnalysisOptions(),
        )
        payload = report.to_dict()
        assert json.loads(json.dumps(payload))["counts"]["evaluated"] == 1
        assert set(payload) >= {
            "counts",
            "detection",
            "honesty",
            "attributes",
            "calibration",
            "cost",
        }

    def test_the_summary_names_attributes_with_no_labelled_data(self, tmp_path):
        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        report = evaluate(
            dataset,
            StubPipeline({"a": _result(_item(category="t-shirt"))}),
            options=AnalysisOptions(),
        )
        summary = report.summary()
        assert "pattern" in summary
        assert "no labelled data" in summary
        assert "detection" in summary


# ---------------------------------------------------------------------- CLI --


class TestCli:
    """The CLI is the way a human will actually run this, so its contract
    matters: missing dataset -> exit 2, evaluated nothing -> exit 1."""

    def test_it_exits_2_when_the_dataset_is_absent(self, tmp_path, capsys):
        from clothing_ai.evaluation.cli import main

        code = main(["--dataset", str(tmp_path / "nope.json"), "--check-dataset"])
        assert code == 2
        assert "No annotation file" in capsys.readouterr().err

    def test_check_dataset_exits_0_and_summarises_labels(self, tmp_path, capsys):
        from clothing_ai.evaluation.cli import main

        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt"}},
                {"id": "b", "expected": {"no_clothing": True}},
            ],
        )
        out_dir = tmp_path / "reports"
        code = main(
            [
                "--dataset",
                str(dataset.root / "annotations" / "bench.json"),
                "--check-dataset",
                "--out",
                str(out_dir),
            ]
        )
        assert code == 0
        out = capsys.readouterr().out
        assert "images: 2" in out
        assert "labelled category: 1" in out
        assert "negatives: 1" in out

    def test_it_writes_report_and_error_files(self, tmp_path, capsys):
        from clothing_ai.evaluation import cli

        dataset = write_dataset(
            tmp_path,
            [
                {"id": "a", "expected": {"category": "t-shirt", "color": "blue"}},
                {"id": "b", "expected": {"category": "dress", "color": "red"}},
            ],
        )
        # Pre-seeding results per id keeps the CLI deterministic without weights.
        canned = {
            "a": _result(_item(category="t-shirt", color="blue")),
            "b": _result(_item(category="t-shirt", color="blue")),  # wrong on purpose
        }

        def fake_evaluate(ds, pipeline=None, **kwargs):
            report = EvaluationReport()
            for annotation in ds:
                record_outcome(report, annotation, canned[annotation.id])
            return report

        monkey = cli.evaluate
        cli.evaluate = fake_evaluate
        try:
            out_dir = tmp_path / "reports"
            code = cli.main(
                [
                    "--dataset",
                    str(dataset.root / "annotations" / "bench.json"),
                    "--out",
                    str(out_dir),
                ]
            )
        finally:
            cli.evaluate = monkey

        assert code == 0
        reports = list(out_dir.glob("report-*.json"))
        errors = list(out_dir.glob("errors-*.json"))
        assert len(reports) == 1 and len(errors) == 1
        report = json.loads(reports[0].read_text(encoding="utf-8"))
        assert report["counts"]["evaluated"] == 2
        assert report["attributes"]["category"]["correct"] == 1
        assert report["attributes"]["category"]["total"] == 2
        errors_payload = json.loads(errors[0].read_text(encoding="utf-8"))
        assert errors_payload["counts"]["wrong_category"] == 1
        out = capsys.readouterr().out
        assert "report:" in out and "errors:" in out

    def test_it_exits_1_when_nothing_was_evaluated(self, tmp_path, capsys):
        from clothing_ai.evaluation import cli

        dataset = write_dataset(
            tmp_path, [{"id": "a", "expected": {"category": "t-shirt"}}]
        )
        (tmp_path / "img-000.png").unlink()  # nothing on disk to evaluate

        def fake_evaluate(ds, pipeline=None, **kwargs):
            report = EvaluationReport()
            for annotation in ds:
                report.skipped.append((annotation.id, "missing"))
            return report

        monkey = cli.evaluate
        cli.evaluate = fake_evaluate
        try:
            code = cli.main(
                [
                    "--dataset",
                    str(dataset.root / "annotations" / "bench.json"),
                    "--out",
                    str(tmp_path / "reports"),
                ]
            )
        finally:
            cli.evaluate = monkey

        assert code == 1
        assert "No images were evaluated" in capsys.readouterr().err
