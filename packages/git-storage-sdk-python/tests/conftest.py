"""Pytest configuration and fixtures."""

import pytest

# Test private key (ES256)
TEST_KEY = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgy3DPdzzsP6tOOvmo
rjbx6L7mpFmKKL2hNWNW3urkN8ehRANCAAQ7/DPhGH3kaWl0YEIO+W9WmhyCclDG
yTh6suablSura7ZDG8hpm3oNsq/ykC3Scfsw6ZTuuVuLlXKV/be/Xr0d
-----END PRIVATE KEY-----"""


@pytest.fixture
def test_key() -> str:
    """Return test private key."""
    return TEST_KEY


@pytest.fixture
def git_storage_options(test_key: str) -> dict:
    """Return GitStorage options for testing."""
    return {
        "name": "test-customer",
        "key": test_key,
        "api_base_url": "https://api.test.code.storage",
        "storage_base_url": "test.code.storage",
        "api_version": 1,
    }
