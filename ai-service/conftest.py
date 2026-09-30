"""Pytest bootstrap.

Two things need to be true before any test module is imported:

* `clothing_ai` is importable, whether or not the service was `pip install -ed`.
* `stubs` is importable, because the tests deliberately share one set of
  stand-in models across modules.

Without this, the suite silently collects nothing and reports success, which is
the most expensive kind of test failure.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TESTS = ROOT / "tests"

for path in (str(ROOT), str(TESTS)):
    if path not in sys.path:
        sys.path.insert(0, path)

# Keep test output quiet unless a run is explicitly debugging. The service's own
# structured logs are useful in production and noise in a passing suite.
os.environ.setdefault("CLOTHING_AI_LOG_LEVEL", "critical")
