"""Stage 6 — consistency validation."""

from .validator import (
    CONTRAST_CONFLICTS,
    AttributeValidator,
    RuleSpec,
    ValidationContext,
    load_material_groups,
    load_rules,
)

__all__ = [
    "CONTRAST_CONFLICTS",
    "AttributeValidator",
    "RuleSpec",
    "ValidationContext",
    "load_material_groups",
    "load_rules",
]
