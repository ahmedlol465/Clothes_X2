"""HTTP contract tests.

These exercise routing, validation, the response envelope and the error
mapping, using a stub pipeline so no weights are needed. What is *not* tested
here is model behaviour; `test_pipeline.py` covers that.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from clothing_ai.api.main import create_app
from clothing_ai.pipeline import ClothingAnalysisPipeline
from clothing_ai.schemas import AnalysisResult, ImageQualityResult

from test_pipeline import build_pipeline
from stubs import encode_garment_png


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    # Replace the lifespan-built pipeline so no model is ever loaded.
    app.router.lifespan_context = _noop_lifespan
    app.state.pipeline = build_pipeline()
    app.state.model_manager = None
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def empty_client() -> TestClient:
    from stubs import StubDetector

    app = create_app()
    app.router.lifespan_context = _noop_lifespan
    app.state.pipeline = build_pipeline(detector=StubDetector(boxes=[]))
    app.state.model_manager = None
    with TestClient(app) as test_client:
        yield test_client


def _noop_lifespan(app):
    """Swaps out model loading so the app can be tested with no weights."""

    @asynccontextmanager
    async def _ctx():
        yield

    return _ctx()


class TestAnalyzeEndpoint:
    def test_returns_the_nestjs_envelope(self, client: TestClient):
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
        )
        assert response.status_code == 200

        body = response.json()
        assert set(body) == {"success", "data", "timestamp"}
        assert body["success"] is True
        assert body["data"]["items"]
        assert body["timestamp"].endswith("Z")

    def test_echoes_x_request_id(self, client: TestClient):
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            headers={"x-request-id": "abc-123"},
        )
        assert response.json()["data"]["request_id"] == "abc-123"

    def test_embedding_can_be_disabled_for_a_smaller_payload(self, client: TestClient):
        with_embedding = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"include_embedding": "true"},
        ).json()
        without = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"include_embedding": "false"},
        ).json()

        assert with_embedding["data"]["items"][0]["embedding"] is not None
        assert without["data"]["items"][0]["embedding"] is None

    def test_mask_is_returned_only_when_requested(self, client: TestClient):
        without = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"include_mask": "false"},
        ).json()
        assert without["data"]["items"][0]["mask_png_base64"] is None

        with_mask = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"include_mask": "true"},
        ).json()
        assert with_mask["data"]["items"][0]["mask_png_base64"]

    def test_mask_is_a_valid_png(self, client: TestClient):
        import base64

        import cv2
        import numpy as np

        body = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"include_mask": "true"},
        ).json()
        raw = base64.b64decode(body["data"]["items"][0]["mask_png_base64"])
        decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
        assert decoded is not None
        assert set(np.unique(decoded)).issubset({0, 255})


class TestHonestFailure:
    def test_no_garment_is_a_200_with_success_false(self, empty_client: TestClient):
        """The client must be able to show 'no clothing item detected'."""
        response = empty_client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("wall.png", encode_garment_png(), "image/png")},
        )
        assert response.status_code == 200

        body = response.json()
        assert body["success"] is False
        assert body["data"]["reason"] == "No clothing item detected"
        assert body["data"]["items"] == []


class TestRequestValidation:
    def test_missing_file_is_422(self, client: TestClient):
        assert client.post("/api/v1/clothing/analyze").status_code == 422

    def test_empty_file_is_400(self, client: TestClient):
        response = client.post(
            "/api/v1/clothing/analyze", files={"file": ("empty.png", b"", "image/png")}
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_non_image_bytes_are_415(self, client: TestClient):
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("evil.png", b"#!/bin/sh\nrm -rf /", "image/png")},
        )
        assert response.status_code == 415

    def test_lying_content_type_does_not_bypass_the_sniff(self, client: TestClient):
        """Content type is a claim; the magic number is the evidence."""
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("evil.png", b"still not an image", "image/png")},
        )
        assert response.status_code == 415

    def test_oversized_upload_is_413(self, client: TestClient):
        from clothing_ai.config.settings import get_settings

        limit = get_settings().max_upload_bytes
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("big.png", b"\x89PNG\r\n\x1a\n" + b"0" * (limit + 10), "image/png")},
        )
        assert response.status_code == 413
        assert "limit" in response.json()["detail"]

    def test_out_of_range_max_items_is_422(self, client: TestClient):
        response = client.post(
            "/api/v1/clothing/analyze",
            files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            data={"max_items": "0"},
        )
        assert response.status_code == 422


class TestOpsEndpoints:
    def test_health_is_503_until_models_are_loaded(self, client: TestClient):
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["status"] == "starting"

    def test_health_is_200_once_loaded(self, client: TestClient):
        class Loaded:
            is_loaded = True
            device = "cpu"

        client.app.state.model_manager = Loaded()
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_vocabulary_is_served_from_the_same_source_as_the_model(
        self, client: TestClient
    ):
        from clothing_ai.config.vocabulary import get_vocabulary

        response = client.get("/api/v1/clothing/vocabulary")
        assert response.status_code == 200

        body = response.json()
        vocab = get_vocabulary()
        assert body["version"] == vocab.version
        assert set(body["attributes"]) == set(vocab.attributes)
        assert len(body["attributes"]["category"]["labels"]) == len(vocab["category"])

    def test_models_endpoint_reports_device_and_models(self, client: TestClient):
        response = client.get("/api/v1/clothing/models")
        assert response.status_code == 200
        body = response.json()
        assert body["device"]
        assert body["detector"]
        assert body["fashion_model"]

    def test_openapi_document_is_servable(self, client: TestClient):
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert "/api/v1/clothing/analyze" in response.json()["paths"]


class TestUninitialised:
    def test_analyze_is_503_when_no_pipeline_is_attached(self):
        app = create_app()
        app.router.lifespan_context = _noop_lifespan
        with TestClient(app) as bare:
            response = bare.post(
                "/api/v1/clothing/analyze",
                files={"file": ("shirt.png", encode_garment_png(), "image/png")},
            )
            assert response.status_code == 503
            assert "not initialised" in response.json()["detail"]
