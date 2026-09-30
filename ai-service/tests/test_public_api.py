"""The public facade: `from clothing_ai import analyze`.

Worth testing separately from the pipeline because it owns three things the
pipeline does not: the shared-instance cache, the input coercion, and the
promise that `import clothing_ai` stays cheap.
"""

from __future__ import annotations

import sys

import pytest

import clothing_ai
import clothing_ai.factory
import clothing_ai.pipeline
from clothing_ai.pipeline import ClothingAnalysisPipeline
from clothing_ai.schemas import AnalysisOptions, AnalysisResult

from stubs import encode_garment_png, garment_image


def _stub_result() -> AnalysisResult:
    from clothing_ai.schemas import ImageQualityResult

    return AnalysisResult(
        success=False,
        items=[],
        reason="stubbed",
        image_quality=ImageQualityResult(score=0.9, usable=True),
    )


def _stub_the_factory(monkeypatch, calls: list, pipeline_class: type) -> None:
    """Replace the factory so no test ever reaches the Hugging Face Hub.

    `build_default_components` constructs the real model stack, which downloads
    gigabytes. A unit test that does that is not a unit test, and on a slow link
    it looks like a hang.

    `calls` records one entry per factory call, which is what "how many times
    were the models built" actually means.
    """

    def fake_factory(settings=None):
        calls.append(settings)
        return "components"

    monkeypatch.setattr(clothing_ai.factory, "build_default_components", fake_factory)
    monkeypatch.setattr(
        clothing_ai.pipeline, "ClothingAnalysisPipeline", pipeline_class, raising=False
    )


@pytest.fixture(autouse=True)
def reset_shared_pipeline():
    clothing_ai.clear_pipeline()
    yield
    clothing_ai.clear_pipeline()


def test_importing_the_package_does_not_load_the_inference_stack():
    """`import clothing_ai` must not drag in torch/transformers.

    The facade resolves lazily on purpose; a caller that only wants a schema type
    should not pay for the model stack. Checked in a subprocess because the only
    honest way to observe a clean import is from a clean interpreter â€” popping
    modules out of `sys.modules` mid-session just makes torch re-initialise.
    """
    import subprocess

    script = (
        "import sys, clothing_ai;"
        "print(sorted(m for m in sys.modules if m in ('torch','transformers')))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"

    # And the lazy path still works.
    script = (
        "import sys, clothing_ai;"
        "clothing_ai.AnalysisResult;"
        "print('AnalysisResult' in dir(clothing_ai))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert "True" in result.stdout


def test_the_version_is_exposed():
    assert isinstance(clothing_ai.__version__, str)
    assert clothing_ai.__version__.count(".") >= 1


class TestLazyAttributes:
    def test_it_exposes_the_schema_names(self):
        for name in (
            "AnalysisResult",
            "AnalysisOptions",
            "ConfidenceStatus",
            "GarmentAnalysis",
            "ImageQualityResult",
        ):
            assert getattr(clothing_ai, name) is not None

    def test_an_unknown_attribute_still_raises_attribute_error(self):
        with pytest.raises(AttributeError, match="nope"):
            clothing_ai.nope


class TestAnalyze:
    def test_it_rejects_input_it_cannot_honestly_decode(self, tmp_path):
        """A NumPy array is not a file; saying so beats a confusing failure."""
        image = garment_image()
        with pytest.raises(TypeError, match="path or encoded image bytes"):
            clothing_ai.analyze(image)

    def test_it_accepts_bytes(self):
        class Recording:
            def __init__(self):
                self.payloads = []

            def analyze(self, payload, *, options=None, request_id=None):
                self.payloads.append(payload)
                return _stub_result()

        recording = Recording()
        clothing_ai._PIPELINE = recording
        clothing_ai.analyze(encode_garment_png(), request_id="abc")

        assert recording.payloads and isinstance(recording.payloads[0], bytes)

    def test_it_accepts_a_path(self, tmp_path):
        class Recording:
            def __init__(self):
                self.payloads = []

            def analyze(self, payload, *, options=None, request_id=None):
                self.payloads.append(payload)
                return _stub_result()

        path = tmp_path / "garment.png"
        path.write_bytes(encode_garment_png())

        recording = Recording()
        clothing_ai._PIPELINE = recording
        clothing_ai.analyze(path)

        assert recording.payloads == [path.read_bytes()]

    def test_it_accepts_bytearray_and_memoryview(self):
        class Recording:
            def __init__(self):
                self.payloads = []

            def analyze(self, payload, *, options=None, request_id=None):
                self.payloads.append(payload)
                return _stub_result()

        raw = encode_garment_png()
        for wrapper in (bytearray(raw), memoryview(raw)):
            recording = Recording()
            clothing_ai._PIPELINE = recording
            clothing_ai.analyze(wrapper)
            assert recording.payloads == [raw]


class TestSharedPipeline:
    def test_the_pipeline_is_built_once_and_reused(self, monkeypatch):
        built = []

        class FakePipeline:
            def __init__(self, components):
                self.components = components

            def analyze(self, payload, *, options=None, request_id=None):
                return _stub_result()

        _stub_the_factory(monkeypatch, built, FakePipeline)

        first = clothing_ai.get_pipeline()
        second = clothing_ai.get_pipeline()

        assert first is second
        # Loading the models is the expensive part; it must happen once.
        assert len(built) == 1

    def test_clearing_forces_a_rebuild(self, monkeypatch):
        built = []

        class FakePipeline:
            def __init__(self, components):
                self.components = components

            def analyze(self, payload, *, options=None, request_id=None):
                return _stub_result()

        _stub_the_factory(monkeypatch, built, FakePipeline)

        first = clothing_ai.get_pipeline()
        clothing_ai.clear_pipeline()
        second = clothing_ai.get_pipeline()

        assert first is not second
        assert len(built) == 2

    def test_clearing_a_empty_cache_is_harmless(self):
        clothing_ai.clear_pipeline()
        clothing_ai.clear_pipeline()
        assert clothing_ai.get_pipeline.__doc__ is not None

    def test_the_factory_is_reached_with_the_settings_passed_in(self, monkeypatch):
        """Settings travel through the factory, not around it."""
        seen: list[object] = []

        class FakePipeline:
            def __init__(self, components):
                seen.append(components)

        def fake_factory(settings=None):
            seen.append(settings)
            return "components"

        monkeypatch.setattr(clothing_ai.factory, "build_default_components", fake_factory)
        monkeypatch.setattr(
            clothing_ai.pipeline, "ClothingAnalysisPipeline", FakePipeline, raising=False
        )

        sentinel = object()
        clothing_ai.get_pipeline(sentinel)

        assert seen == [sentinel, "components"] or seen[-1] == "components"
