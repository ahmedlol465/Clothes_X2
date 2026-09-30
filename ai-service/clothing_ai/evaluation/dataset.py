"""The benchmark dataset format.

A JSON file, hand-written or generated, describing one image and what a human
said is in it. Deliberately plain: the point of this phase is to measure, and a
schema nobody can edit by hand will not get edited by hand.

```json
{
  "version": 1,
  "images": [
    {
      "id": "shirt-001",
      "file": "raw/shirt-001.jpg",
      "expected": {
        "category": "t-shirt",
        "color": "blue",
        "pattern": "solid",
        "style": "casual",
        "material": null
      },
      "coarse_label": "top",
      "split": "val",
      "notes": "hangs against a white wall"
    }
  ]
}
```

Rules that keep the numbers honest:

* `expected` may be `null` for an attribute. That means "not labelled", **not**
  "correct". Those images are excluded from that attribute's accuracy rather
  than counted as failures.
* `expected.no_clothing = true` marks a deliberate negative. The pipeline must
  reject these, and getting one wrong is counted as a false positive.
* `split` is `train`/`val`/`test`. `test` is never used for tuning.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

from pydantic import BaseModel, Field

from ..common.logging import get_logger

log = get_logger(__name__)

#: The attributes the benchmark scores, in the order they appear in reports.
SCORED_ATTRIBUTES: tuple[str, ...] = ("category", "color", "pattern", "style", "material")

VALID_SPLITS = ("train", "val", "test")


class ExpectedAttributes(BaseModel):
    """Ground truth. `None` means the annotator did not label it."""

    category: str | None = None
    subcategory: str | None = None
    color: str | None = None
    pattern: str | None = None
    style: str | None = None
    material: str | None = None
    secondary_colors: list[str] = Field(default_factory=list)
    no_clothing: bool = Field(
        False, description="A deliberate negative: nothing wearable is in frame."
    )

    def labelled(self) -> dict[str, str]:
        return {
            name: value
            for name, value in self.model_dump().items()
            if isinstance(value, str) and value
        }


class Annotation(BaseModel):
    id: str
    file: str
    expected: ExpectedAttributes = Field(default_factory=ExpectedAttributes)
    coarse_label: str | None = None
    split: str = "val"
    notes: str | None = None


class Dataset(BaseModel):
    version: int = 1
    images: list[Annotation] = Field(default_factory=list)
    root: Path | None = None

    def by_split(self, split: str) -> list[Annotation]:
        if split not in VALID_SPLITS:
            raise ValueError(f"split must be one of {VALID_SPLITS}, got {split!r}")
        return [item for item in self.images if item.split == split]

    def negatives(self) -> list[Annotation]:
        return [item for item in self.images if item.expected.no_clothing]

    def resolve(self, annotation: Annotation) -> Path:
        base = self.root or Path.cwd()
        return base / annotation.file

    def missing_files(self) -> list[str]:
        """Labels whose image is not on disk.

        Reported rather than skipped silently: a missing file quietly shrinks
        the benchmark, and a smaller benchmark reports better numbers than it
        should.
        """
        return [
            item.file
            for item in self.images
            if not self.resolve(item).exists()
        ]

    def __len__(self) -> int:
        return len(self.images)

    def __iter__(self) -> Iterator[Annotation]:
        return iter(self.images)


def load_dataset(path: Path | str) -> Dataset:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"annotation file not found: {path}")
    # `utf-8-sig`, not `utf-8`: these files get hand-edited, and anything that
    # writes them from Windows (Notepad, Excel, PowerShell) prepends a BOM,
    # which `json.load` rejects outright. `utf-8-sig` reads both.
    with path.open("r", encoding="utf-8-sig") as handle:
        payload: dict[str, Any] = json.load(handle)

    dataset = Dataset.model_validate(payload)
    # Annotations are written relative to the annotation file's own directory,
    # so a dataset can be moved without rewriting every `file` entry.
    dataset.root = path.parent.parent if path.parent.name == "annotations" else path.parent

    seen: set[str] = set()
    duplicates = {item.id for item in dataset.images if item.id in seen or seen.add(item.id)}
    if duplicates:
        raise ValueError(f"duplicate annotation ids: {sorted(duplicates)}")

    for item in dataset.images:
        if item.split not in VALID_SPLITS:
            raise ValueError(
                f"annotation {item.id!r} has split={item.split!r}; expected one of {VALID_SPLITS}"
            )

    missing = dataset.missing_files()
    if missing:
        log.warning("dataset_missing_images", count=len(missing), examples=missing[:5])
    log.info(
        "dataset_loaded",
        images=len(dataset),
        negatives=len(dataset.negatives()),
        missing=len(missing),
        path=str(path),
    )
    return dataset


def save_dataset(dataset: Dataset, path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dataset.model_dump(mode="json", exclude={"root"})
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


__all__ = [
    "SCORED_ATTRIBUTES",
    "VALID_SPLITS",
    "Annotation",
    "Dataset",
    "ExpectedAttributes",
    "load_dataset",
    "save_dataset",
]
