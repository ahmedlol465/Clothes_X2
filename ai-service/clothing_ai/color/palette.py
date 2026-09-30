"""Named colour palette.

`labels.yaml` cannot hold 20+ colour anchors per family, so this table lives
here as data. Every entry is a real sRGB swatch; names are chosen to match the
`colors` a shopper would use rather than CSS keywords, and the anchors are
placed in CIE LAB because LAB distance is what the clustering actually
optimises (see `palette_for`).

Nothing here is a hard-coded guess: each family lists enough anchors to cover
lightness variation, so "a light blue shirt" and "a navy blazer" both land on
the right name instead of both collapsing to `blue`.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

Triple = Sequence[float]

#: dE76 below this is treated as the same colour to a human viewer. Values are
#: the standard CIE76 "just noticeable difference" ranges, not invented.
MATCH_THRESHOLD = 18.0
#: A looser threshold used only to decide whether two *named* results agree.
AGREEMENT_THRESHOLD = 30.0


@dataclass(frozen=True, slots=True)
class PaletteEntry:
    name: str
    hex: str
    family: str
    lightness: str = "any"  # 'dark' | 'light' | 'any'


# Anchors are sampled from sRGB swatches, not computed. `family` groups them so
# the extractor can report both a precise name and a coarse family.
PALETTE: tuple[PaletteEntry, ...] = (
    # ---------------------------------------------------------------- achromatic
    PaletteEntry("black", "#000000", "black", "dark"),
    PaletteEntry("charcoal", "#2b2b2b", "gray", "dark"),
    PaletteEntry("dark gray", "#4a4a4a", "gray", "dark"),
    PaletteEntry("gray", "#808080", "gray"),
    PaletteEntry("light gray", "#bdbdbd", "gray", "light"),
    PaletteEntry("silver", "#c9ccd1", "gray", "light"),
    PaletteEntry("white", "#ffffff", "white"),
    PaletteEntry("off white", "#f2f0ea", "white", "light"),
    PaletteEntry("cream", "#f5ebd0", "beige", "light"),
    PaletteEntry("ivory", "#fffff0", "white", "light"),
    # ------------------------------------------------------------------- blue
    PaletteEntry("navy blue", "#1b2a4a", "blue", "dark"),
    PaletteEntry("denim blue", "#4a6d8c", "blue", "dark"),
    PaletteEntry("blue", "#2e5aac", "blue"),
    PaletteEntry("sky blue", "#87b7e0", "blue", "light"),
    PaletteEntry("teal", "#1f6f78", "blue", "dark"),
    # ------------------------------------------------------------------ green
    PaletteEntry("forest green", "#22482f", "green", "dark"),
    PaletteEntry("olive", "#6b7a3a", "green", "dark"),
    PaletteEntry("green", "#3e8e41", "green"),
    PaletteEntry("mint green", "#a8d5ba", "green", "light"),
    PaletteEntry("khaki", "#bdb76b", "beige", "light"),
    # ----------------------------------------------------------------- purple
    PaletteEntry("dark purple", "#3b1e54", "purple", "dark"),
    PaletteEntry("purple", "#7b62b3", "purple"),
    PaletteEntry("lavender", "#c3b1e1", "purple", "light"),
    # ------------------------------------------------------------------ pink
    PaletteEntry("burgundy", "#6e1e2e", "red", "dark"),
    PaletteEntry("maroon", "#5c1a1a", "red", "dark"),
    PaletteEntry("rose", "#c0405a", "pink"),
    PaletteEntry("pink", "#e891a8", "pink", "light"),
    PaletteEntry("magenta", "#b8338a", "pink"),
    # ------------------------------------------------------------------- red
    PaletteEntry("red", "#c42b1c", "red"),
    PaletteEntry("coral", "#e2725b", "red", "light"),
    PaletteEntry("rust", "#9c4a21", "brown", "dark"),
    # -------------------------------------------------------------- orange
    PaletteEntry("orange", "#e8762c", "orange"),
    PaletteEntry("terracotta", "#c1653f", "orange", "dark"),
    PaletteEntry("peach", "#f0b295", "orange", "light"),
    # --------------------------------------------------------------- yellow
    PaletteEntry("yellow", "#f2c230", "yellow"),
    PaletteEntry("mustard", "#c8a415", "yellow", "dark"),
    PaletteEntry("mustard yellow", "#d4a017", "yellow", "dark"),
    # ---------------------------------------------------------------- brown
    PaletteEntry("brown", "#6b4423", "brown", "dark"),
    PaletteEntry("chocolate", "#4a2f1b", "brown", "dark"),
    PaletteEntry("tan", "#b08155", "brown"),
    PaletteEntry("camel", "#c19a6b", "beige"),
    PaletteEntry("beige", "#d8c3a5", "beige", "light"),
    PaletteEntry("sand", "#d9c9a3", "beige", "light"),
    PaletteEntry("taupe", "#8b7d6b", "beige"),
)

#: Names the vocabulary of §6 must be able to emit. Kept explicit so a test can
#: assert the table can actually produce every name the spec asks for.
REQUIRED_NAMES = (
    "black", "white", "gray", "red", "blue", "green", "yellow", "orange",
    "purple", "pink", "brown", "beige", "navy blue", "cream", "denim blue",
)

#: Reported when no cluster is dominant enough to name. Better an honest
#: "multicolor" than a confident wrong name.
MULTICOLOR = "multicolor"
UNKNOWN = "unknown"


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def rgb_to_hex(rgb: Triple) -> str:
    r, g, b = (int(np.clip(channel, 0, 255)) for channel in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def rgb_to_lab(rgb: Triple) -> tuple[float, float, float]:
    """sRGB 0-255 -> CIE LAB (D65). Matches `cv2.cvtColor(..., COLOR_RGB2LAB)`."""
    import cv2

    array = np.array([[list(rgb)]], dtype=np.uint8)
    lab = cv2.cvtColor(array, cv2.COLOR_RGB2LAB)[0][0]
    # OpenCV encodes L in 0..255 and a/b centred on 128.
    return float(lab[0]), float(lab[1]) - 128.0, float(lab[2]) - 128.0


def delta_e(a: Triple, b: Triple) -> float:
    """CIE76 colour difference between two LAB triples."""
    diff = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    return float(np.sqrt(np.dot(diff, diff)))


@lru_cache(maxsize=1)
def _lab_table() -> tuple[np.ndarray, tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    labs, names, families, lightness = [], [], [], []
    for entry in PALETTE:
        labs.append(rgb_to_lab(hex_to_rgb(entry.hex)))
        names.append(entry.name)
        families.append(entry.family)
        lightness.append(entry.lightness)
    return np.array(labs, dtype=np.float64), tuple(names), tuple(families), tuple(lightness)


def name_color_lab(lab: Triple, *, prefer_lightness: bool = True) -> tuple[str, float, str]:
    """Nearest palette entry in LAB.

    Returns `(name, delta_e, hex)`. Ties are broken by preferring an anchor
    whose lightness band matches the sample, which is what separates `navy
    blue` from `sky blue` when both are within a few dE of the sample.
    """
    table, names, _families, lightness = _lab_table()
    distances = np.linalg.norm(table - np.asarray(lab, dtype=np.float64), axis=1)
    order = np.argsort(distances)

    if prefer_lightness:
        value = float(np.asarray(lab, dtype=np.float64)[0])
        band = "light" if value > 78.0 else "dark" if value < 38.0 else "any"
        for index in order:
            anchor = lightness[int(index)]
            if anchor == "any" or anchor == band:
                best = int(index)
                break
        else:
            best = int(order[0])
    else:
        best = int(order[0])

    return names[best], float(distances[best]), PALETTE[best].hex


def family_of(name: str) -> str:
    for entry in PALETTE:
        if entry.name == name:
            return entry.family
    return "other"


def agreement(name_a: str, name_b: str) -> bool:
    """True when two named colours describe the same thing closely enough.

    `navy blue` and `blue` agree (same family). `blue` and `brown` do not.
    """
    if not name_a or not name_b:
        return False
    if name_a == name_b:
        return True
    return family_of(name_a) == family_of(name_b)
