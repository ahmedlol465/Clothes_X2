"""Stage 6 — deterministic consistency validation.

Two models can disagree, and the point of this stage is to *not* paper over
that. `jeans` + `silk` is flagged, not silently rewritten. `blue` from the
zero-shot head versus `brown` from KMeans is reported as uncertain, not
resolved by picking a favourite.

Rules are declared in `config/validation_rules.yaml`. This module only knows
how to evaluate the predicates; it contains no garment knowledge, so adding a
rule is a config edit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import yaml

from ..color.palette import family_of
from ..common.logging import get_logger
from ..config.settings import get_settings
from ..schemas import AttributePrediction, ColorResult, ValidationResult, ValidationRule

log = get_logger(__name__)

#: Colour pairs that genuinely never appear on a single garment. Deliberately
#: short: a long list of "impossible" pairings is just a list of assumptions.
CONTRAST_CONFLICTS: frozenset[frozenset[str]] = frozenset(
    {
        frozenset({"black", "white"}),
        frozenset({"blue", "yellow"}),
        frozenset({"navy blue", "orange"}),
        frozenset({"purple", "yellow"}),
    }
)

#: A colour distribution flatter than this counts as "solid" for the pattern
#: cross-check. Measured, not assumed — see evaluation/colour_space_report.
FLAT_COLOUR_STD = 0.045

#: Groups that never constrain a cross-check: the fallback detector has no real
#: vocabulary and `other` is a legitimate output.
PERMISSIVE_GROUPS = frozenset({"other", "unknown"})


@dataclass(frozen=True, slots=True)
class RuleSpec:
    code: str
    description: str
    severity: str
    penalty: float
    when: dict[str, Any] | None
    #: Optional exception list. A rule with no `require` has no exceptions and
    #: fires whenever its `when` clause holds.
    require: dict[str, Any] | None = None
    message: str = ""


@dataclass(frozen=True, slots=True)
class ValidationContext:
    """Everything a rule is allowed to look at. Nothing else is in scope."""

    category: str | None = None
    material: str | None = None
    pattern: str | None = None
    style: str | None = None
    coarse_label: str | None = None
    category_group: str = "other"
    detector_group: str = "other"
    detector_gate_applied: bool = False
    measured_color: str | None = None
    zero_shot_color: str | None = None
    secondary_colors: tuple[str, ...] = ()
    color_spread: float = 0.0
    segmentation_filled: bool = False

    def as_fields(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "material": self.material,
            "pattern": self.pattern,
            "style": self.style,
            "coarse_label": self.coarse_label,
            "group": self.category_group,
            "detector_group": self.detector_group,
            "measured_color": self.measured_color,
            "zeroshot_color": self.zero_shot_color,
            "secondary_color": ", ".join(self.secondary_colors) or "none",
            "color_spread": round(self.color_spread, 4),
            "segmentation_filled": self.segmentation_filled,
        }


class AttributeValidator:
    """Evaluate the declared rules against one garment's attributes."""

    def __init__(
        self,
        rules: tuple[RuleSpec, ...] | None = None,
        *,
        material_groups: dict[str, list[str]] | None = None,
    ) -> None:
        self._rules = rules if rules is not None else load_rules()
        self._material_groups = material_groups if material_groups is not None else load_material_groups()
        self._predicates: dict[str, Callable[[ValidationContext, Any], bool]] = {
            "category_in": self._category_in,
            "category_not_in": self._category_not_in,
            "material_in": self._material_in,
            "material_not_in": self._material_not_in,
            "pattern_in": self._pattern_in,
            "pattern_not_in": self._pattern_not_in,
            "material_group_in": self._material_group_in,
            "color_source_disagree": self._color_source_disagree,
            "color_contrast_excessive": self._color_contrast_excessive,
            "pattern_color_conflict": self._pattern_color_conflict,
            "detector_label_mismatch": self._detector_label_mismatch,
            "segmentation_filled": self._segmentation_filled,
        }

    @property
    def rule_codes(self) -> list[str]:
        return [rule.code for rule in self._rules]

    # ------------------------------------------------------------------ main --

    def validate(
        self,
        *,
        category: AttributePrediction | None = None,
        material: AttributePrediction | None = None,
        pattern: AttributePrediction | None = None,
        style: AttributePrediction | None = None,
        color: ColorResult | None = None,
        coarse_label: str | None = None,
        category_group: str = "other",
        detector_group: str = "other",
        detector_gate_applied: bool = False,
        segmentation_filled: bool = False,
        zero_shot_color: str | None = None,
    ) -> ValidationResult:
        context = ValidationContext(
            category=category.value if category else None,
            material=material.value if material else None,
            pattern=pattern.value if pattern else None,
            style=style.value if style else None,
            coarse_label=coarse_label,
            category_group=category_group,
            detector_group=detector_group,
            detector_gate_applied=detector_gate_applied,
            measured_color=color.primary if color else None,
            zero_shot_color=zero_shot_color,
            secondary_colors=tuple(color.secondary) if color else (),
            color_spread=self._colour_spread(color),
            segmentation_filled=segmentation_filled,
        )

        results: list[ValidationRule] = []
        penalties: dict[str, float] = {}
        flags: list[str] = []

        for rule in self._rules:
            if not self._matches(rule.when, context):
                continue
            # `require` is an *exception* list, not a requirement. A rule with
            # no `require` clause has no exceptions and therefore fires. Testing
            # an absent clause would read as "satisfied" and silently disable
            # every rule that does not need one.
            if rule.require and self._matches(rule.require, context):
                continue
            results.append(
                ValidationRule(
                    code=rule.code,
                    description=rule.description,
                    passed=False,
                    detail=self._render(rule.message, context),
                )
            )
            flags.append(rule.code)
            if rule.severity == "error":
                penalties[rule.code] = rule.penalty

        consistent = not penalties
        if flags:
            log.info("validation", consistent=consistent, failed=flags)
        return ValidationResult(
            consistent=consistent, rules=results, penalties=penalties, flags=flags
        )

    # ------------------------------------------------------------ predicates --

    def _matches(self, condition: dict[str, Any] | None, context: ValidationContext) -> bool:
        """All clauses must hold; an empty or absent clause is always true."""
        if not condition:
            return True
        for key, expected in condition.items():
            predicate = self._predicates.get(key)
            if predicate is None:
                raise KeyError(
                    f"unknown validation predicate {key!r}; available: {sorted(self._predicates)}"
                )
            if not predicate(context, expected):
                return False
        return True

    # Membership helpers. An absent attribute never satisfies a rule: it is
    # better to skip a check than to invent a value for it.
    @staticmethod
    def _category_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.category is not None and ctx.category in expected

    @staticmethod
    def _category_not_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.category is not None and ctx.category not in expected

    @staticmethod
    def _material_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.material is not None and ctx.material in expected

    @staticmethod
    def _material_not_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.material is not None and ctx.material not in expected

    @staticmethod
    def _pattern_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.pattern is not None and ctx.pattern in expected

    @staticmethod
    def _pattern_not_in(ctx: ValidationContext, expected: list[str]) -> bool:
        return ctx.pattern is not None and ctx.pattern not in expected

    def _material_group_in(self, ctx: ValidationContext, expected: list[str]) -> bool:
        if ctx.material is None:
            return False
        return any(ctx.material in self._material_groups.get(group, []) for group in expected)

    def _color_source_disagree(self, ctx: ValidationContext, expected: bool = True) -> bool:
        if not ctx.zero_shot_color or not ctx.measured_color:
            return False
        return family_of(ctx.zero_shot_color) != family_of(ctx.measured_color)

    def _color_contrast_excessive(self, ctx: ValidationContext, expected: bool = True) -> bool:
        if not ctx.measured_color:
            return False
        primary_family = family_of(ctx.measured_color)
        for secondary in ctx.secondary_colors:
            if frozenset({primary_family, family_of(secondary)}) in CONTRAST_CONFLICTS:
                return True
        return False

    @staticmethod
    def _pattern_color_conflict(ctx: ValidationContext, expected: bool = True) -> bool:
        """A real pattern reported on a garment measured as one flat colour.

        Three guards, all necessary:

        * a pattern must actually have been reported — with no pattern this is
          not a conflict, it is an absence of evidence;
        * the pattern must be a non-solid one, or the rule contradicts itself;
        * a colour must have been measured at all. `color_spread` is `0.0` when
          there is no colour, which is indistinguishable from "measured as
          perfectly flat" unless it is checked separately.
        """
        if ctx.pattern is None or ctx.measured_color is None:
            return False
        if ctx.pattern in ("solid", "other"):
            return False
        return ctx.color_spread < FLAT_COLOUR_STD

    @staticmethod
    def _detector_label_mismatch(ctx: ValidationContext, expected: bool = True) -> bool:
        """A category from the wrong coarse group, when gating could not prevent it.

        When the detector is confident the fusion layer restricts the candidate
        set, so a mismatch is already impossible. The check earns its keep in
        the other case: a weak or fallback detection leaves the full vocabulary
        open, and a `dress` predicted inside a `shoes` box is worth flagging.
        """
        if ctx.detector_gate_applied:
            return False
        if ctx.detector_group in PERMISSIVE_GROUPS or ctx.category_group in PERMISSIVE_GROUPS:
            return False
        if ctx.category is None:
            return False
        return ctx.category_group != ctx.detector_group

    @staticmethod
    def _segmentation_filled(ctx: ValidationContext, expected: bool = True) -> bool:
        return ctx.segmentation_filled

    @staticmethod
    def _render(template: str, context: ValidationContext) -> str:
        try:
            return template.format(**context.as_fields())
        except (KeyError, IndexError):  # pragma: no cover - config guard
            return template

    @staticmethod
    def _colour_spread(color: ColorResult | None) -> float:
        """Standard deviation of the colour distribution.

        0.0 for a perfectly solid garment, rising as the split between named
        clusters widens. Used to detect a pattern reported on a flat colour.

        Returns `1.0` — maximal spread, i.e. maximally *un*flat — when there is
        no colour to measure, so "no measurement" can never be mistaken for
        "measured as uniformly flat".
        """
        if not color or not color.distribution:
            return 1.0
        shares = [value for key, value in color.distribution.items() if key != "other"]
        if len(shares) < 2:
            return 0.0
        mean = sum(shares) / len(shares)
        return float((sum((share - mean) ** 2 for share in shares) / len(shares)) ** 0.5)


@lru_cache(maxsize=2)
def load_rules(path: Path | None = None) -> tuple[RuleSpec, ...]:
    target = path or get_settings().validation_rules_file
    if not target.exists():
        raise FileNotFoundError(f"validation rules not found: {target}")
    with target.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    rules = tuple(
        RuleSpec(
            code=item["code"],
            description=item.get("description", ""),
            severity=item.get("severity", "error"),
            penalty=float(item.get("penalty", 0.1)),
            when=item.get("when") or {},
            require=item.get("require") or {},
            message=item.get("message", ""),
        )
        for item in payload.get("rules", [])
    )
    log.debug("validation_rules_loaded", count=len(rules), path=str(target))
    return rules


@lru_cache(maxsize=2)
def load_material_groups(path: Path | None = None) -> dict[str, list[str]]:
    target = path or get_settings().validation_rules_file
    with target.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    return dict(payload.get("material_groups") or {})
