"""Stage 4a — colour extraction."""

from .kmeans_extractor import ColorExtractor, ColorExtractorConfig, ColorExtractorProtocol
from .palette import (
    MATCH_THRESHOLD,
    MULTICOLOR,
    PALETTE,
    REQUIRED_NAMES,
    agreement,
    delta_e,
    family_of,
    hex_to_rgb,
    name_color_lab,
    rgb_to_hex,
    rgb_to_lab,
)

__all__ = [
    "ColorExtractor",
    "ColorExtractorConfig",
    "ColorExtractorProtocol",
    "MATCH_THRESHOLD",
    "MULTICOLOR",
    "PALETTE",
    "REQUIRED_NAMES",
    "agreement",
    "delta_e",
    "family_of",
    "hex_to_rgb",
    "name_color_lab",
    "rgb_to_hex",
    "rgb_to_lab",
]
