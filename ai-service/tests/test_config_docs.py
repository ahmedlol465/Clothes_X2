"""The configuration and its documentation must not drift apart.

A variable that exists but is undocumented gets ignored. A variable that is
documented but no longer exists gets set, silently does nothing, and is worse:
it looks like the operator is in control when they are not.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

from clothing_ai.config.settings import Settings

ENV_EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"

# Read by `SettingsConfigDict(env_file=...)` before the prefix machinery runs,
# so it is not a Settings field and is legitimately absent from the model.
BOOTSTRAP_VARS = {"CLOTHING_AI_ENV_FILE"}

VAR_PATTERN = re.compile(r"^\s*(CLOTHING_AI_[A-Z0-9_]+)\s*=", re.MULTILINE)

#: Test environment overrides, so the suite can stay quiet. `conftest.py` sets
#: these to keep pytest output readable, which means they are always present
#: during a test run and would otherwise shadow `.env.example` entirely.
TEST_ENV_OVERRIDES = {
    "CLOTHING_AI_LOG_LEVEL",
    "CLOTHING_AI_DETERMINISTIC",
}


def documented_vars() -> set[str]:
    assert ENV_EXAMPLE.exists(), f"{ENV_EXAMPLE} is missing; it is the setup doc"
    return set(VAR_PATTERN.findall(ENV_EXAMPLE.read_text(encoding="utf-8")))


def field_vars() -> set[str]:
    return {f"CLOTHING_AI_{name.upper()}" for name in Settings.model_fields}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove every `CLOTHING_AI_*` override so the file is really the source.

    pydantic-settings gives environment variables priority over `env_file`, so
    without this the file is never actually consulted for any field the suite
    happens to set — the test passes while proving nothing.
    """
    for name in [n for n in os.environ if n.startswith("CLOTHING_AI_")]:
        monkeypatch.delenv(name, raising=False)


class TestEnvExample:
    def test_every_setting_is_documented(self):
        """A setting nobody can discover is a setting nobody will set."""
        missing = sorted(field_vars() - documented_vars())
        assert not missing, (
            f"Settings has undocumented fields: {missing}. Add them to "
            f".env.example with what they trade against."
        )

    def test_nothing_is_documented_that_does_not_exist(self):
        """A stale variable reads as control and provides none."""
        phantom = sorted(documented_vars() - field_vars() - BOOTSTRAP_VARS)
        assert not phantom, (
            f".env.example documents variables that are not settings: {phantom}. "
            f"Remove them, or add the field."
        )

    def test_the_prefix_is_the_one_the_loader_expects(self):
        prefix = Settings.model_config.get("env_prefix")
        assert prefix == "CLOTHING_AI_"
        for var in documented_vars() - BOOTSTRAP_VARS:
            assert var.startswith(prefix), f"{var} is missing the {prefix} prefix"

    def test_the_file_is_loadable_as_a_real_settings_file(self, clean_env):
        """It must actually parse, with the types the model expects.

        The environment is cleared for the `CLOTHING_AI_*` prefix first, because
        environment variables outrank the file: without this the parse silently
        tests the environment's values and the file is never read at all. That
        hole once let a documented `LOG_LEVEL=INFO` through, which the strict
        literal then rejected at startup.
        """
        parsed = Settings(_env_file=ENV_EXAMPLE)
        for name in ("accept_threshold", "uncertain_threshold", "report_floor"):
            value = getattr(parsed, name)
            assert isinstance(value, float), f"{name} parsed as {type(value).__name__}"
        assert parsed.max_retries == 1
        assert parsed.enable_secondary_classifier is False
        assert parsed.eager_load is True
        # Values that only exist in the file, not in the test environment.
        assert parsed.log_level == "info"
        assert parsed.max_upload_bytes == 12 * 1024 * 1024

    def test_the_file_survives_an_all_caps_log_level(self):
        """`LOG_LEVEL=INFO` is what everyone writes. It must work."""
        assert Settings(log_level="INFO", _env_file=None).log_level == "info"

    def test_an_unknown_log_level_names_the_valid_options(self):
        with pytest.raises(Exception, match="must be one of"):
            Settings(log_level="verbose", _env_file=None)

    def test_the_risky_variables_carry_an_explanation(self):
        """A variable documented only by its name is not documented.

        The settings most likely to be misconfigured under time pressure are the
        confidence thresholds and the retry budget. Each must have a comment that
        says what the number buys and what it costs.
        """
        text = ENV_EXAMPLE.read_text(encoding="utf-8")
        lines = text.splitlines()
        # Comments precede the variable they describe in this file, so the
        # explanation is found by walking backwards over the comment block.
        explanation_before: dict[str, str] = {}
        for index, line in enumerate(lines):
            match = re.match(r"^\s*(CLOTHING_AI_[A-Z0-9_]+)\s*=", line)
            if not match:
                continue
            for preceding in reversed(lines[:index]):
                stripped = preceding.strip()
                if not stripped or stripped.startswith("CLOTHING_AI_"):
                    break
                if stripped.startswith("#"):
                    explanation_before[match.group(1)] = stripped.lstrip("# ").strip()
                    break

        critical = [
            "CLOTHING_AI_ACCEPT_THRESHOLD",
            "CLOTHING_AI_UNCERTAIN_THRESHOLD",
            "CLOTHING_AI_REPORT_FLOOR",
            "CLOTHING_AI_MAX_RETRIES",
            "CLOTHING_AI_EAGER_LOAD",
            "CLOTHING_AI_OFFLINE",
        ]
        undocumented = [
            name for name in critical if len(explanation_before.get(name, "")) < 20
        ]
        assert not undocumented, (
            f"no meaningful explanation after: {undocumented}. Say what the value "
            f"buys and what it costs."
        )


class TestDefaultsAreSane:
    """A default that is wrong is a bug that only shows up in production."""

    def test_the_threshold_ordering_is_inverted_correctly(self):
        s = Settings(_env_file=None)
        assert s.uncertain_threshold < s.accept_threshold
        assert 0.0 <= s.uncertain_threshold <= s.accept_threshold <= 1.0

    def test_the_report_floor_is_below_the_uncertain_threshold(self):
        """Otherwise nothing would ever be reported, or everything would be."""
        s = Settings(_env_file=None)
        assert 0.0 < s.report_floor < s.uncertain_threshold

    @pytest.mark.parametrize(
        "field", ["max_upload_bytes", "max_image_dimension", "max_garments"]
    )
    def test_limits_are_positive(self, field):
        s = Settings(_env_file=None)
        assert getattr(s, field) > 0
