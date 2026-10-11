"""Tests for the Settings profile card + Social Trading / Customer Support features."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

DEFAULT_SOCIAL = "https://wefundclient.com/copy-trading/login.php"
DEFAULT_SUPPORT = "https://wefundclient.com/contact"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login", json={"password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(autouse=True, scope="module")
def _ensure_defaults(admin_headers):
    """Make sure defaults are the broker defaults before/after test module runs."""
    requests.put(
        f"{BASE_URL}/api/admin/settings",
        json={
            "social_trading_url_default": DEFAULT_SOCIAL,
            "support_url_default": DEFAULT_SUPPORT,
            "broker_name": "ApexFX",
            "allow_funds": True,
        },
        headers=admin_headers,
        timeout=15,
    )
    yield
    requests.put(
        f"{BASE_URL}/api/admin/settings",
        json={
            "social_trading_url_default": DEFAULT_SOCIAL,
            "support_url_default": DEFAULT_SUPPORT,
            "broker_name": "ApexFX",
            "allow_funds": True,
        },
        headers=admin_headers,
        timeout=15,
    )
    requests.delete(f"{BASE_URL}/api/admin/users/abc123", headers=admin_headers, timeout=15)


# --- Login returns the new fields ---
class TestLoginFields:
    def test_demo_login_fields(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"user_id": "3245615", "password": "Dhanu@41"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] is True
        assert data["user_id"] == "3245615"
        assert data["name"] is None
        assert data["email"] is None
        assert data["account_type"] == "Live"
        assert data["social_trading_url"] == DEFAULT_SOCIAL
        assert data["support_url"] == DEFAULT_SUPPORT


# --- /api/account/{id} returns name/social/support ---
class TestAccountFields:
    def test_account_has_links_and_name(self):
        r = requests.get(f"{BASE_URL}/api/account/3245615", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "social_trading_url" in data
        assert "support_url" in data
        assert "name" in data
        assert data["name"] is None
        assert data["social_trading_url"] == DEFAULT_SOCIAL
        assert data["support_url"] == DEFAULT_SUPPORT


# --- Admin user create & per-user override ---
class TestAdminUserOverrides:
    def test_create_user_with_overrides_and_login(self, admin_headers):
        payload = {
            "user_id": "abc123",
            "password": "test",
            "name": "John Smith",
            "social_trading_url": "https://custom.social/abc123",
            "support_url": "https://custom.help/abc123",
        }
        r = requests.post(f"{BASE_URL}/api/admin/users", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["user_id"] == "abc123"
        assert created["name"] == "John Smith"

        # Now login as that user
        r2 = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"user_id": "abc123", "password": "test"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["name"] == "John Smith"
        assert d["social_trading_url"] == "https://custom.social/abc123"
        assert d["support_url"] == "https://custom.help/abc123"
        assert d["account_type"] == "Live"


# --- Default URLs propagate for users without override ---
class TestDefaultPropagation:
    def test_updating_defaults_affects_non_override_users(self, admin_headers):
        new_social = "https://default.social"
        new_support = "https://default.help"
        r = requests.put(
            f"{BASE_URL}/api/admin/settings",
            json={
                "social_trading_url_default": new_social,
                "support_url_default": new_support,
            },
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        try:
            # Login as the original user (no override)
            r2 = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"user_id": "3245615", "password": "Dhanu@41"},
                timeout=15,
            )
            assert r2.status_code == 200
            d = r2.json()
            assert d["social_trading_url"] == new_social
            assert d["support_url"] == new_support
        finally:
            # reset back
            requests.put(
                f"{BASE_URL}/api/admin/settings",
                json={
                    "social_trading_url_default": DEFAULT_SOCIAL,
                    "support_url_default": DEFAULT_SUPPORT,
                },
                headers=admin_headers,
                timeout=15,
            )


# --- Regression: deposit still works ---
class TestFundsRegression:
    def test_deposit_100(self):
        r = requests.post(
            f"{BASE_URL}/api/funds/deposit",
            json={"user_id": "3245615", "amount": 100, "method": "card"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["success"] is True
        assert d["account"]["balance"] >= 100
