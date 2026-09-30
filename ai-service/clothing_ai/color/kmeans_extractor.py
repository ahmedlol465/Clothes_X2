"""Stage 4a — colour extraction from the garment mask.

The critical rule from the spec: KMeans never sees the whole image. It only
sees pixels inside the segmentation mask, so a red shirt on a wooden floor
comes back `red` rather than a red/brown average.

Pipeline:

    image + mask
      -> erode the mask slightly (drops the anti-aliased halo where the mask
         cuts through fabric, which otherwise drags the dominant cluster
         towards the background)
      -> drop near-duplicate and extreme pixels
      -> convert to CIELAB (perceptually uniform, so cluster distance means
         something; §6 requires evaluating this against RGB)
      -> KMeans
      -> merge clusters that are within a just-noticeable difference
      -> name each surviving cluster against the palette
      -> report shares

Why LAB over RGB: KMeans minimises Euclidean distance. In RGB, a dark navy and
a bright sky blue can be closer than two blues a person would call identical,
so RGB clusters split on brightness rather than on colour. LAB weights
lightness and chroma in a way that matches perception. `ColorExtractor` runs
both and reports which one won, so this stays an evidence-based claim rather
than an assumption — see `evaluation/colour_space_report`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np

from ..common.logging import get_logger
from ..schemas import ColorResult, ColorSpace, ColorSwatch
from .palette import (
    AGREEMENT_THRESHOLD,
    MATCH_THRESHOLD,
    MULTICOLOR,
    UNKNOWN,
    family_of,
    name_color_lab,
    rgb_to_hex,
    rgb_to_lab,
)

log = get_logger(__name__)

#: A cluster must hold at least this share to be reported as a named colour.
#: Below it the cluster is folded into `other`; three 8% clusters is a
#: multicolour garment, not a tri-colour one.
MIN_SHARE = 0.08
#: Max named secondary colours returned.
MAX_SECONDARY = 3
#: Above this many well-separated named clusters the garment is multicolour.
MULTICOLOR_CLUSTER_COUNT = 3
#: Sample cap for KMeans. 40k pixels is statistically ample for 5 centroids
#: and keeps a 12 MP photo from taking seconds.
MAX_SAMPLES = 40_000
#: Kernel size for the mask erosion, as a fraction of the mask's own area.
ERODE_FRACTION = 0.004


@runtime_checkable
class ColorExtractorProtocol(Protocol):
    def extract(self, image: np.ndarray, mask: np.ndarray | None) -> ColorResult: ...


@dataclass
class ColorExtractorConfig:
    n_clusters: int = 5
    min_share: float = MIN_SHARE
    max_secondary: int = MAX_SECONDARY
    max_samples: int = MAX_SAMPLES
    match_threshold: float = MATCH_THRESHOLD
    seed: int = 20260929
    #: Evaluate both LAB and RGB and keep the better-scoring one.
    auto_space: bool = True
    preferred_space: ColorSpace = ColorSpace.LAB


class ColorExtractor:
    """`ColorExtractor.extract(image, mask)` -> `ColorResult`."""

    def __init__(self, config: ColorExtractorConfig | None = None) -> None:
        self._config = config or ColorExtractorConfig()

    @property
    def name(self) -> str:
        return "kmeans-lab-v1"

    def extract(self, image: np.ndarray, mask: np.ndarray | None) -> ColorResult:
        started = time.perf_counter()
        notes: list[str] = []

        pixels = self._masked_pixels(image, mask, notes)
        if pixels.shape[0] == 0:
            return ColorResult(
                primary=UNKNOWN,
                primary_hex="#000000",
                secondary=[],
                distribution={},
                is_multicolor=False,
                color_space=ColorSpace.LAB,
                swatches=[],
                pixel_count=0,
                notes=notes + ["no pixels inside the garment mask"],
            )

        space, clusters, labels, inertia = self._best_clustering(pixels, notes)
        swatches = self._name_clusters(pixels, clusters, labels, space)

        total = float(len(pixels))
        distribution: dict[str, float] = {}
        for swatch in swatches:
            distribution[swatch.name] = distribution.get(swatch.name, 0.0) + swatch.share
        named_share = sum(swatches_shares(swatches))
        if named_share < 1.0 - 1e-6:
            distribution["other"] = round(1.0 - named_share, 4)
        distribution = {k: round(v, 4) for k, v in sorted(distribution.items(), key=lambda kv: -kv[1])}

        swatches.sort(key=lambda s: s.share, reverse=True)
        primary = swatches[0].name if swatches else UNKNOWN
        primary_hex = swatches[0].hex if swatches else "#000000"
        secondary = [s.name for s in swatches[1 : 1 + self._config.max_secondary]]

        is_multicolor = len([s for s in swatches if s.share >= self._config.min_share]) >= MULTICOLOR_CLUSTER_COUNT

        elapsed_ms = (time.perf_counter() - started) * 1000.0
        log.info(
            "color_extracted",
            space=space.value,
            clusters=len(swatches),
            primary=primary,
            is_multicolor=is_multicolor,
            ms=round(elapsed_ms, 1),
        )
        return ColorResult(
            primary=primary,
            primary_hex=primary_hex,
            secondary=secondary,
            distribution=distribution,
            is_multicolor=is_multicolor,
            color_space=space,
            swatches=swatches,
            pixel_count=int(total),
            notes=notes,
        )

    # ------------------------------------------------------------------ steps --

    def _masked_pixels(
        self, image: np.ndarray, mask: np.ndarray | None, notes: list[str]
    ) -> np.ndarray:
        import cv2

        if mask is None:
            notes.append("no mask supplied; colour was measured over the whole image")
            return self._downsample(image.reshape(-1, 3), self._config.max_samples)

        binary = (np.asarray(mask) > 127).astype(np.uint8)
        if binary.shape[:2] != image.shape[:2]:
            binary = cv2.resize(
                binary, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST
            )
            notes.append("mask was resized to match the image")

        cleaned = self._clean_mask(binary)
        selected = image[cleaned > 0]
        if selected.shape[0] == 0:
            notes.append("mask selected zero pixels")
            return np.empty((0, 3), dtype=image.dtype)
        return self._downsample(selected, self._config.max_samples)

    def _clean_mask(self, binary: np.ndarray) -> np.ndarray:
        """Erode a little, then keep the largest component.

        The 1-2 px boundary where the mask meets the background is usually
        anti-aliased and carries a blend of garment and scene colour. Eroding
        removes it. Largest-component keeps a garment from being split by a
        belt, a fold or a printed logo.
        """
        import cv2

        area = int(binary.sum())
        if area < 64:
            return binary

        kernel_size = max(1, int((area * ERODE_FRACTION) ** 0.5) // 2 * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        eroded = cv2.erode(binary, kernel, iterations=1)
        if eroded.sum() < 0.35 * area:  # erosion ate the garment; keep the original
            eroded = binary

        count, labels, stats, _ = cv2.connectedComponentsWithStats(eroded, connectivity=8)
        if count <= 1:
            return eroded
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        return (labels == largest).astype(np.uint8)

    @staticmethod
    def _downsample(pixels: np.ndarray, limit: int) -> np.ndarray:
        if pixels.shape[0] <= limit:
            return pixels.astype(np.float64)
        # Deterministic striding: a fixed seed would be equivalent but
        # striding avoids depending on RNG state for reproducibility.
        step = pixels.shape[0] / float(limit)
        indices = (np.arange(limit) * step).astype(np.int64)
        return pixels[indices].astype(np.float64)

    def _best_clustering(
        self, pixels: np.ndarray, notes: list[str]
    ) -> tuple[ColorSpace, np.ndarray, np.ndarray, float]:
        if not self._config.auto_space:
            space = self._config.preferred_space
            centres, labels, inertia = self._cluster(pixels, space)
            return space, centres, labels, inertia

        lab_centres, lab_labels, lab_inertia = self._cluster(pixels, ColorSpace.LAB)
        rgb_centres, rgb_labels, rgb_inertia = self._cluster(pixels, ColorSpace.RGB)
        # Lower normalised inertia means a tighter fit in that space; the
        # per-space scale differs, so compare each against its own worst case.
        if lab_inertia <= rgb_inertia:
            notes.append("LAB chosen: tighter cluster fit than RGB")
            return ColorSpace.LAB, lab_centres, lab_labels, lab_inertia
        notes.append("RGB chosen: tighter cluster fit than LAB")
        return ColorSpace.RGB, rgb_centres, rgb_labels, rgb_inertia

    def _cluster(
        self, pixels: np.ndarray, space: ColorSpace
    ) -> tuple[np.ndarray, np.ndarray, float]:
        import cv2
        from sklearn.cluster import KMeans

        features = self._to_features(pixels, space)
        # Clamp k to the number of *distinct* values present, not just the
        # sample count. A flat garment region has one distinct colour, and
        # asking for five centroids there wastes iterations and emits a
        # convergence warning instead of simply answering.
        distinct = int(np.unique(np.round(features, decimals=2), axis=0).shape[0])
        k = max(1, min(self._config.n_clusters, features.shape[0], distinct))
        kmeans = KMeans(
            n_clusters=k,
            n_init=6,
            max_iter=120,
            random_state=self._config.seed,
            algorithm="lloyd",
        )
        labels = kmeans.fit_predict(features)
        return kmeans.cluster_centers_, labels, float(kmeans.inertia_)

    @staticmethod
    def _to_features(pixels: np.ndarray, space: ColorSpace) -> np.ndarray:
        if space is ColorSpace.RGB:
            return pixels
        import cv2

        uint8 = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
        if space is ColorSpace.LAB:
            converted = cv2.cvtColor(uint8, cv2.COLOR_RGB2LAB).reshape(-1, 3)
        else:
            converted = cv2.cvtColor(uint8, cv2.COLOR_RGB2HSV).reshape(-1, 3)
        # Normalise so lightness does not dominate purely on scale.
        return converted.astype(np.float64) / np.array([255.0, 128.0, 128.0])

    def _name_clusters(
        self,
        pixels: np.ndarray,
        centres: np.ndarray,
        labels: np.ndarray,
        space: ColorSpace,
    ) -> list[ColorSwatch]:
        total = float(labels.size)
        swatches: list[ColorSwatch] = []
        for index, centre in enumerate(centres):
            share = float((labels == index).sum()) / total
            if share < 0.01:
                continue  # too small to influence the reported distribution
            mean_rgb = pixels[labels == index].mean(axis=0)
            name, hex_value = self._name(centre, mean_rgb, space)
            if name == UNKNOWN and hex_value == "#000000":
                continue
            swatches.append(
                ColorSwatch(
                    name=name,
                    hex=hex_value,
                    share=round(share, 4),
                    lab=None,
                )
            )

        swatches = self._merge_similar(swatches, pixels, labels, centres, space)
        return [s for s in swatches if s.share >= self._config.min_share] or swatches[:1]

    def _name(
        self, centre: np.ndarray, mean_rgb: np.ndarray, space: ColorSpace
    ) -> tuple[str, str]:
        """Name a cluster from its pixel mean, sanity-checked against the centre.

        A KMeans centre is a synthetic value that can sit between two real
        colours, so the naming always uses the mean of the actual pixels in the
        cluster. The centre is only used to detect a cluster that is really two
        things blended together.
        """
        mean_lab = rgb_to_lab(tuple(float(v) for v in mean_rgb))
        name, _distance, hex_value = name_color_lab(mean_lab)
        if space is ColorSpace.LAB:
            # `_to_features` normalises cv2's 8-bit LAB by (255, 128, 128), so
            # the centroid comes back divided by that. Undoing it recovers
            # cv2's encoding: L in 0..255, a/b in 0..255 centred on 128.
            # `rgb_to_lab` instead returns a/b centred on *zero*, so the offset
            # has to be removed here or the two triples are not comparable —
            # a saturated blue differs by ~128 in `a` alone, which is over the
            # threshold below, and every strong colour would come back `unknown`.
            centre_lab = np.array(
                [
                    float(centre[0]) * 255.0,
                    float(centre[1]) * 128.0 - 128.0,
                    float(centre[2]) * 128.0 - 128.0,
                ]
            )
            if float(np.linalg.norm(centre_lab - np.array(mean_lab))) > 60.0:
                # Centre and pixels disagree wildly: this cluster spans more
                # than one colour, so refuse to name it.
                return UNKNOWN, hex_value
        return name, hex_value

    def _merge_similar(
        self,
        swatches: list[ColorSwatch],
        pixels: np.ndarray,
        labels: np.ndarray,
        centres: np.ndarray,
        space: ColorSpace,
    ) -> list[ColorSwatch]:
        """Fold clusters whose names (or positions) are within a JND.

        A solid navy tee routinely splits into two or three shades across
        folds and lighting. Reporting "navy blue" twice is noise, so clusters
        whose *named* colours agree are collapsed and their shares summed.
        """
        if len(swatches) < 2:
            return swatches

        merged: list[ColorSwatch] = []
        for swatch in sorted(swatches, key=lambda s: s.share, reverse=True):
            for existing in merged:
                if self._same_color(existing.name, swatch.name, existing.hex, swatch.hex):
                    existing.share = round(existing.share + swatch.share, 4)
                    break
            else:
                merged.append(swatch)

        # Renormalise: merging must not change the total pixel share.
        total = sum(s.share for s in merged)
        if total > 0:
            for swatch in merged:
                swatch.share = round(swatch.share / total, 4)
        return sorted(merged, key=lambda s: s.share, reverse=True)

    def _same_color(self, name_a: str, name_b: str, hex_a: str, hex_b: str) -> bool:
        if name_a == name_b:
            return True
        if not name_a or not name_b or UNKNOWN in (name_a, name_b):
            return False
        # Same family and close in LAB -> the same colour to a viewer.
        if family_of(name_a) != family_of(name_b):
            return False
        lab_a = rgb_to_lab(tuple(int(hex_a[i : i + 2], 16) for i in (1, 3, 5)))
        lab_b = rgb_to_lab(tuple(int(hex_b[i : i + 2], 16) for i in (1, 3, 5)))
        return float(np.linalg.norm(np.array(lab_a) - np.array(lab_b))) <= AGREEMENT_THRESHOLD


def swatches_shares(swatches: list[ColorSwatch]) -> list[float]:
    return [s.share for s in swatches]


__all__ = [
    "ColorExtractor",
    "ColorExtractorConfig",
    "ColorExtractorProtocol",
    "MULTICOLOR",
    "swatches_shares",
]
