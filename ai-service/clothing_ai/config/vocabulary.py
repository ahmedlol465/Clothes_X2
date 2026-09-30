"""Loads `labels.yaml` into typed objects shared by every stage.

This is the single reason adding a class does not require a code change: the
detector gate, the zero-shot head, the validator and the benchmark all read
their vocabularies from here.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

import yaml

from .settings import get_settings


@dataclass(frozen=True, slots=True)
class LabelSpec:
    """One candidate class for an attribute head."""

    value: str
    prompt: str
    group: str = "other"


@dataclass(frozen=True, slots=True)
class AttributeSpec:
    """All candidates for one attribute, plus how the head should be trusted."""

    name: str
    labels: tuple[LabelSpec, ...]
    source: str = "fashion"
    enabled: bool = True
    gated_by_detector: bool = False
    confidence_cap: float = 1.0

    def __iter__(self) -> Iterator[LabelSpec]:
        return iter(self.labels)

    def __len__(self) -> int:
        return len(self.labels)

    @property
    def values(self) -> list[str]:
        return [label.value for label in self.labels]

    @property
    def prompts(self) -> list[str]:
        return [label.prompt for label in self.labels]

    def by_group(self, group: str) -> tuple[LabelSpec, ...]:
        return tuple(label for label in self.labels if label.group == group)

    def get(self, value: str) -> LabelSpec | None:
        return next((label for label in self.labels if label.value == value), None)


class AttributeVocabulary:
    """Parsed `labels.yaml`."""

    def __init__(self, payload: dict[str, Any], *, source: Path | None = None) -> None:
        self._payload = payload
        self.source = source
        self.version = int(payload.get("version", 1))
        self.defaults: dict[str, Any] = dict(payload.get("defaults", {}))

        self.attributes: dict[str, AttributeSpec] = {}
        for name, spec in (payload.get("attributes") or {}).items():
            labels = tuple(
                LabelSpec(
                    value=item["value"],
                    prompt=item["prompt"],
                    group=item.get("group", "other"),
                )
                for item in (spec.get("labels") or [])
            )
            if not labels:
                raise ValueError(f"attribute {name!r} declares no labels")
            self.attributes[name] = AttributeSpec(
                name=spec.get("name", name),
                labels=labels,
                source=spec.get("source", "fashion"),
                enabled=bool(spec.get("enabled", True)),
                gated_by_detector=bool(spec.get("gated_by_detector", False)),
                confidence_cap=float(spec.get("confidence_cap", 1.0)),
            )

        missing = {"category", "material", "pattern", "style"} - self.attributes.keys()
        if missing:
            raise ValueError(f"labels.yaml is missing required attributes: {sorted(missing)}")

        self.detector_group_map: dict[str, str] = dict(payload.get("detector_group_map") or {})

    # ------------------------------------------------------------ accessors --

    def __getitem__(self, name: str) -> AttributeSpec:
        try:
            return self.attributes[name]
        except KeyError as exc:
            raise KeyError(f"unknown attribute {name!r}; have {sorted(self.attributes)}") from exc

    def default(self, key: str, fallback: Any = None) -> Any:
        return self.defaults.get(key, fallback)

    def detector_to_group(self, detector_label: str) -> str:
        """Map a detector's own label onto one of our coarse groups.

        Unknown labels degrade to `other` rather than raising, so swapping in a
        fashion-trained detector with a different vocabulary cannot crash the
        pipeline; it just loses the candidate gating.
        """
        return self.detector_group_map.get(detector_label.strip().lower(), "other")

    def group_for(self, attribute: str, value: str) -> str:
        spec = self[attribute].get(value)
        return spec.group if spec else "other"

    def active_attributes(self) -> list[AttributeSpec]:
        return [spec for spec in self.attributes.values() if spec.enabled]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"AttributeVocabulary(v{self.version}, {sorted(self.attributes)})"


def load_vocabulary(path: Path | None = None) -> AttributeVocabulary:
    target = path or get_settings().labels_file
    if not target.exists():
        raise FileNotFoundError(f"label vocabulary not found: {target}")
    with target.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    return AttributeVocabulary(payload, source=target)


@lru_cache(maxsize=2)
def get_vocabulary(path: Path | None = None) -> AttributeVocabulary:
    return load_vocabulary(path)
