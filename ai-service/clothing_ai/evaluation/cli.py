"""`clothing-ai-evaluate` — run the benchmark and write the reports."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..common.logging import configure_logging, get_logger
from ..config.settings import get_settings
from .dataset import VALID_SPLITS, load_dataset
from .evaluate import confusion_matrix, error_analysis, evaluate

log = get_logger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="clothing-ai-evaluate",
        description=(
            "Score the clothing pipeline against a labelled set. Writes a JSON "
            "report and an error analysis; prints a summary to stdout."
        ),
    )
    parser.add_argument(
        "-d",
        "--dataset",
        default=None,
        help="Annotation JSON. Defaults to settings.annotations_file.",
    )
    parser.add_argument(
        "-s",
        "--split",
        default="val",
        choices=list(VALID_SPLITS),
        help="Which split to score. Default: val (never 'test' by accident).",
    )
    parser.add_argument(
        "-o",
        "--out",
        default=None,
        help="Report directory. Defaults to <data_dir>/evaluation/reports.",
    )
    parser.add_argument(
        "-n",
        "--limit",
        type=int,
        default=None,
        help="Evaluate only the first N images (smoke runs).",
    )
    parser.add_argument(
        "--embedding",
        action="store_true",
        help="Include embeddings in the pipeline run (slower, usually unwanted).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full report as JSON instead of the summary table.",
    )
    parser.add_argument(
        "--check-dataset",
        action="store_true",
        help="Validate the annotation file and exit without running the pipeline.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    configure_logging(level=settings.log_level, json_output=False)

    path = Path(args.dataset) if args.dataset else settings.annotations_file
    if not path.exists():
        print(
            f"No annotation file at {path}.\n"
            f"Create it, or pass --dataset. See clothing_ai/evaluation/dataset.py "
            f"for the format.",
            file=sys.stderr,
        )
        return 2

    dataset = load_dataset(path)

    if args.check_dataset:
        print(_dataset_check(dataset))
        return 0

    images = dataset.by_split(args.split)
    if not images:
        print(f"Split {args.split!r} contains no images.", file=sys.stderr)
        return 2
    dataset.images = images

    missing = dataset.missing_files()
    if missing:
        print(
            f"Warning: {len(missing)} annotated image(s) are not on disk and will be "
            f"skipped. The report will be based on fewer images than it claims.",
            file=sys.stderr,
        )

    from ..schemas import AnalysisOptions

    report = evaluate(
        dataset,
        options=AnalysisOptions(include_embedding=args.embedding, include_mask=False),
        limit=args.limit,
    )
    report.scores = {"split": args.split}

    out_dir = Path(args.out) if args.out else settings.data_dir / "evaluation" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = _timestamp()
    report_path = out_dir / f"report-{stamp}.json"
    analysis_path = out_dir / f"errors-{stamp}.json"

    analysis = error_analysis(report)
    report_path.write_text(
        json.dumps(report.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    analysis_path.write_text(
        json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    if args.json:
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        print()
        print(report.summary())
        print()
        print("Error analysis")
        print("--------------")
        for name, count in sorted(analysis["counts"].items()):
            if count:
                print(f"  {name:<42} {count}")
        print()
        for advice in analysis["suggested_next_steps"]:
            print(f"  * {advice}")
        print()
        print("Per-attribute confusion (expected -> predicted):")
        for name in ("category", "color"):
            matrix = confusion_matrix(report, name)
            if matrix:
                print(f"  {name}: {json.dumps(matrix, ensure_ascii=False)}")

    print()
    print(f"report:  {report_path}")
    print(f"errors:  {analysis_path}")

    # A benchmark that found nothing is not a success.
    if report.evaluated == 0:
        print("\nNo images were evaluated. Check the paths in the annotation file.", file=sys.stderr)
        return 1
    return 0


def _dataset_check(dataset) -> str:
    from .dataset import SCORED_ATTRIBUTES

    lines = [f"images: {len(dataset)}", f"missing files: {len(dataset.missing_files())}"]
    for split in VALID_SPLITS:
        lines.append(f"  {split}: {len(dataset.by_split(split))}")
    lines.append(f"negatives: {len(dataset.negatives())}")
    for name in SCORED_ATTRIBUTES:
        labelled = sum(
            1
            for item in dataset
            if getattr(item.expected, name, None)
        )
        lines.append(f"  labelled {name}: {labelled}")
    return "\n".join(lines)


def _timestamp() -> str:
    import time

    return time.strftime("%Y%m%d-%H%M%S", time.localtime())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
