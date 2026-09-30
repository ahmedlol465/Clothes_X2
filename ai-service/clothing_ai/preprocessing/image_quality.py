"""Stage 1 — image quality gate.

Runs before any model is touched. The job is to fail fast and loudly on
unusable input rather than emit a confident guess, and to explain *why* an
image was rejected so the mobile client can ask for a better photo.

All metrics are plain OpenCV/NumPy on the decoded image, so this stage costs
single-digit milliseconds.
"""

from __future__ import annotations

import numpy as np

from ..common.logging import get_logger
from ..schemas import ImageQualityResult, QualityIssue, Severity

log = get_logger(__name__)

# Thresholds were chosen from the spread of photos a phone camera produces, not
# from any benchmark: they are deliberately permissive, because a false "bad
# image" rejection costs the user more than a slow, uncertain re-shoot.
MIN_SHORT_EDGE = 160
LOW_RES_SCORE = 0.30
BLUR_VARIANCE_FLOOR = 60.0      # variance of Laplacian; <60 is visibly soft
BLUR_VARIANCE_CEILING = 2500.0  # >2500 usually means sensor noise, not detail
DARK_MEAN = 28.0
BRIGHT_MEAN = 236.0
LOW_CONTRAST_STD = 18.0
OCCLUSION_MAX_COVERAGE = 0.035  # mask pixels outside any box, 0-1
MIN_USABLE_FOREGROUND = 0.02     # foreground must be >= 2% of the frame

_ISSUE_WEIGHTS = {
    "low_resolution": 0.35,
    "blurry": 0.30,
    "too_dark": 0.25,
    "too_bright": 0.25,
    "low_contrast": 0.20,
    "no_foreground": 1.00,
    "mostly_occluded": 0.30,
}


class ImageQualityChecker:
    """Compute a quality score and the issues behind it."""

    def __init__(
        self,
        *,
        min_short_edge: int = MIN_SHORT_EDGE,
        dark_mean: float = DARK_MEAN,
        bright_mean: float = BRIGHT_MEAN,
        blur_floor: float = BLUR_VARIANCE_FLOOR,
    ) -> None:
        self.min_short_edge = min_short_edge
        self.dark_mean = dark_mean
        self.bright_mean = bright_mean
        self.blur_floor = blur_floor

    def check(self, image: np.ndarray) -> ImageQualityResult:
        """`image` is RGB uint8, shape (H, W, 3)."""
        if image is None or image.size == 0:
            return ImageQualityResult(
                score=0.0,
                usable=False,
                issues=[
                    QualityIssue(
                        code="empty_image",
                        message="The uploaded file decoded to an empty image.",
                        severity=Severity.ERROR,
                    )
                ],
            )

        height, width = image.shape[:2]
        gray = self._to_gray(image)

        brightness = float(gray.mean())
        contrast = float(gray.std())
        sharpness = float(self._laplacian_variance(gray))
        entropy = self._entropy(gray)
        foreground = self._foreground_ratio(image)
        saturation = float(self._mean_saturation(image))

        metrics = {
            "width": float(width),
            "height": float(height),
            "short_edge": float(min(width, height)),
            "aspect_ratio": round(width / max(1, height), 4),
            "brightness_mean": round(brightness, 3),
            "brightness_std": round(contrast, 3),
            "sharpness_laplacian_var": round(sharpness, 3),
            "entropy": round(entropy, 4),
            "foreground_ratio": round(foreground, 4),
            "mean_saturation": round(saturation, 4),
        }

        issues: list[QualityIssue] = []
        short_edge = min(width, height)

        if short_edge < self.min_short_edge:
            issues.append(
                QualityIssue(
                    code="low_resolution",
                    message=(
                        f"Shortest side is {short_edge}px; at least "
                        f"{self.min_short_edge}px is needed to read fabric detail."
                    ),
                    severity=Severity.ERROR if short_edge < self.min_short_edge / 2 else Severity.WARNING,
                    measured=float(short_edge),
                    threshold=float(self.min_short_edge),
                )
            )

        if brightness < self.dark_mean:
            issues.append(
                QualityIssue(
                    code="too_dark",
                    message="The image is too dark to judge colour or fabric.",
                    severity=Severity.ERROR if brightness < self.dark_mean / 2 else Severity.WARNING,
                    measured=round(brightness, 2),
                    threshold=self.dark_mean,
                )
            )
        elif brightness > self.bright_mean:
            issues.append(
                QualityIssue(
                    code="too_bright",
                    message="The image is overexposed; detail is washed out.",
                    severity=Severity.WARNING,
                    measured=round(brightness, 2),
                    threshold=self.bright_mean,
                )
            )

        if sharpness < self.blur_floor:
            issues.append(
                QualityIssue(
                    code="blurry",
                    message="The image is out of focus.",
                    severity=Severity.WARNING,
                    measured=round(sharpness, 2),
                    threshold=self.blur_floor,
                )
            )

        if contrast < LOW_CONTRAST_STD:
            issues.append(
                QualityIssue(
                    code="low_contrast",
                    message="Very low contrast; the subject barely separates from the background.",
                    severity=Severity.WARNING,
                    measured=round(contrast, 2),
                    threshold=LOW_CONTRAST_STD,
                )
            )

        if foreground < MIN_USABLE_FOREGROUND:
            issues.append(
                QualityIssue(
                    code="no_foreground",
                    message="No distinct subject was found; the frame is nearly uniform.",
                    severity=Severity.ERROR,
                    measured=round(foreground, 4),
                    threshold=MIN_USABLE_FOREGROUND,
                )
            )

        score = self._score(issues, metrics)
        usable = not any(issue.severity is Severity.ERROR for issue in issues)

        result = ImageQualityResult(
            score=score, issues=issues, metrics=metrics, usable=usable
        )
        if issues:
            log.info(
                "image_quality",
                score=round(score, 3),
                usable=usable,
                issues=[i.code for i in issues],
            )
        return result

    # ------------------------------------------------------------------------ #

    def _score(self, issues: list[QualityIssue], metrics: dict[str, float]) -> float:
        penalty = 0.0
        for issue in issues:
            weight = _ISSUE_WEIGHTS.get(issue.code, 0.1)
            if issue.severity is Severity.ERROR:
                weight *= 1.5
            penalty += weight
        return float(max(0.0, min(1.0, 1.0 - penalty)))

    @staticmethod
    def _to_gray(image: np.ndarray) -> np.ndarray:
        import cv2

        if image.ndim == 2:
            return image
        # Input is RGB; OpenCV weights expect BGR, so convert explicitly.
        return cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    @staticmethod
    def _laplacian_variance(gray: np.ndarray) -> float:
        import cv2

        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    @staticmethod
    def _entropy(gray: np.ndarray) -> float:
        import cv2

        hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
        total = hist.sum()
        if total <= 0:
            return 0.0
        probabilities = hist[hist > 0] / total
        return float(-(probabilities * np.log2(probabilities)).sum())

    @staticmethod
    def _foreground_ratio(image: np.ndarray) -> float:
        """Cheap subject estimate: border-sampled background, then count deviation.

        A garment photo almost always has a subject that differs from the frame
        border. This is only a sanity check for "is there anything here at all";
        the detector is what actually locates garments.
        """
        import cv2

        height, width = image.shape[:2]
        if height < 8 or width < 8:
            return 1.0
        band = max(1, min(height, width) // 20)
        border = np.concatenate(
            [
                image[:band].reshape(-1, 3),
                image[-band:].reshape(-1, 3),
                image[:, :band].reshape(-1, 3),
                image[:, -band:].reshape(-1, 3),
            ]
        ).astype(np.float32)
        background = np.median(border, axis=0)
        distance = np.linalg.norm(image.astype(np.float32) - background, axis=2)
        return float((distance > 28.0).mean())

    @staticmethod
    def _mean_saturation(image: np.ndarray) -> float:
        import cv2

        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
        return float(hsv[:, :, 1].mean() / 255.0)
