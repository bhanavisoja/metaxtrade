"""
Iteration 3 regression tests for ApexFX:
  - P&L moves balance on close
  - Max-lot formula under $1k (balance/1000)
  - Admin login + create/edit/delete users
  - Admin settings update (broker_name, allow_funds)
  - Blocked account (equity<=0) returns blocked:true, blocks placing, auto-liquidation
  - close_batch (all / winners / losers)
  - /settings/public exposes branding + allow_funds
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

_FRONTEND_ENV = "/app/frontend/.env"
BACKEND_URL = ""
with open(_FRONTEND_ENV) as fh:
    for line in fh:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BACKEND_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BACKEND_URL}/api"

USER_ID = "3245615"
PASSWORD = "Dhanu@41"
ADMIN_PASSWORD = "admin123"


def _warm_prices():
    for _ in range(5):
        r = requests.get(f"{API}/prices", timeout=15)
        if r.ok and r.json().get("data", {}).get("EUR/USD"):
            return
        time.sleep(1.5)


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/login", json={"password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    assert tok
    return tok


# --- Section 1: account summary shape ---------------------------------------
class TestAccountShape:
    def test_summary_includes_new_fields(self):
        r = requests.get(f"{API}/account/{USER_ID}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("equity", "floating_pnl", "realised_pnl", "blocked", "max_lots"):
            assert k in body, f"missing {k}"
        assert body["blocked"] is False
        assert body["max_lots"] == 6.0


# --- Section 2: realised PnL moves balance ----------------------------------
class TestRealisedPnlMovesBalance:
    def test_close_order_updates_balance(self):
        _warm_prices()
        baseline = requests.get(f"{API}/account/{USER_ID}", timeout=15).json()
        start_balance = baseline["balance"]
        r = requests.post(f"{API}/orders/place", json={
            "user_id": USER_ID, "symbol": "EUR/USD", "side": "buy", "lots": 1.0,
        }, timeout=20)
        assert r.status_code == 200, r.text
        order_id = r.json()["order"]["id"]
        time.sleep(1)
        c = requests.post(f"{API}/orders/close", json={
            "order_id": order_id, "user_id": USER_ID,
        }, timeout=20)
        assert c.status_code == 200, c.text
        realised = c.json()["order"]["pnl"]
        assert realised <= 0, f"freshly closed market should be commission-negative, got {realised}"
        after = requests.get(f"{API}/account/{USER_ID}", timeout=15).json()
        assert abs(after["balance"] - (start_balance + realised)) < 0.05, (
            f"balance didn't move: start={start_balance} realised={realised} after={after['balance']}"
        )
        assert abs(after["realised_pnl"] - realised) < 0.05


# --- Section 3: Admin login ------------------------------------------------
class TestAdminLogin:
    def test_bad_password(self):
        r = requests.post(f"{API}/admin/login", json={"password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_good_password_returns_token(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 10


# --- Section 4: Max-lot formula under $1000 --------------------------------
class TestMaxLotFormulaUnder1k:
    def test_balance_override_500_yields_half_lot(self, admin_token):
        uid = f"TEST500_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"user_id": uid, "password": "p", "name": "TEST", "balance_override": 500},
            timeout=15)
        assert r.status_code == 200, r.text
        acc = requests.get(f"{API}/account/{uid}", timeout=15).json()
        assert acc["balance"] == 500.0
        assert acc["max_lots"] == 0.5, f"expected 0.5, got {acc['max_lots']}"
        # Cleanup
        requests.delete(f"{API}/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}"})

    def test_place_exceeds_max_lots(self, admin_token):
        _warm_prices()
        uid = f"TEST500B_{uuid.uuid4().hex[:6]}"
        requests.post(f"{API}/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"user_id": uid, "password": "p", "balance_override": 500}, timeout=15)
        r = requests.post(f"{API}/orders/place", json={
            "user_id": uid, "symbol": "EUR/USD", "side": "buy", "lots": 1.0,
        }, timeout=15)
        assert r.status_code == 400
        assert "exceeds max allowed" in r.json().get("detail", "")
        requests.delete(f"{API}/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}"})


# --- Section 5: Blocked account --------------------------------------------
class TestBlockedAccount:
    def test_zero_balance_blocked(self, admin_token):
        uid = f"BLK_{uuid.uuid4().hex[:6]}"
        requests.post(f"{API}/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"user_id": uid, "password": "p", "balance_override": 0}, timeout=15)
        acc = requests.get(f"{API}/account/{uid}", timeout=15).json()
        assert acc["blocked"] is True
        assert acc["max_lots"] == 0

        r = requests.post(f"{API}/orders/place", json={
            "user_id": uid, "symbol": "EUR/USD", "side": "buy", "lots": 0.01,
        }, timeout=15)
        assert r.status_code == 403, r.text
        assert "zero or negative" in r.json().get("detail", "").lower()
        requests.delete(f"{API}/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}"})


# --- Section 6: Liquidation sweep ------------------------------------------
class TestLiquidation:
    def test_balance_zeroed_closes_all_opens(self, admin_token):
        _warm_prices()
        uid = f"LIQ_{uuid.uuid4().hex[:6]}"
        headers = {"Authorization": f"Bearer {admin_token}"}
        # Start with $50 — enough for 0.05 lot? No; max_lots=0.05 → commission=$1 → leaves equity $49.
        # To force liquidation, place order then flip balance_override=0.
        requests.post(f"{API}/admin/users", headers=headers,
            json={"user_id": uid, "password": "p", "balance_override": 50}, timeout=15)
        p1 = requests.post(f"{API}/orders/place", json={
            "user_id": uid, "symbol": "EUR/USD", "side": "buy", "lots": 0.05,
        }, timeout=15)
        assert p1.status_code == 200, p1.text
        # Zero out balance
        requests.post(f"{API}/admin/users", headers=headers,
            json={"user_id": uid, "balance_override": 0}, timeout=15)
        # Wait up to 6s for liquidation sweep (price loop runs every 2s).
        liquidated = False
        for _ in range(6):
            time.sleep(1.5)
            hist = requests.get(f"{API}/orders/history/{uid}", timeout=15).json()
            if hist and any(o.get("close_reason") == "liquidation" for o in hist):
                liquidated = True
                break
        assert liquidated, "no liquidation close_reason seen in history"
        pos = requests.get(f"{API}/orders/positions/{uid}", timeout=15).json()
        assert all(p["status"] != "open" for p in pos)
        requests.delete(f"{API}/admin/users/{uid}", headers=headers)


# --- Section 7: close_batch ------------------------------------------------
class TestCloseBatch:
    def test_close_all(self, admin_token):
        _warm_prices()
        uid = f"BATCH_{uuid.uuid4().hex[:6]}"
        headers = {"Authorization": f"Bearer {admin_token}"}
        requests.post(f"{API}/admin/users", headers=headers,
            json={"user_id": uid, "password": "p", "balance_override": 10000}, timeout=15)
        for _ in range(3):
            requests.post(f"{API}/orders/place", json={
                "user_id": uid, "symbol": "EUR/USD", "side": "buy", "lots": 0.1,
            }, timeout=15)
        before = requests.get(f"{API}/orders/positions/{uid}", timeout=15).json()
        assert len(before) == 3
        r = requests.post(f"{API}/orders/close_batch", json={
            "user_id": uid, "scope": "all",
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["closed_count"] == 3
        after = requests.get(f"{API}/orders/positions/{uid}", timeout=15).json()
        assert len(after) == 0
        requests.delete(f"{API}/admin/users/{uid}", headers=headers)

    def test_close_losers_only(self, admin_token):
        _warm_prices()
        uid = f"BATCH2_{uuid.uuid4().hex[:6]}"
        headers = {"Authorization": f"Bearer {admin_token}"}
        requests.post(f"{API}/admin/users", headers=headers,
            json={"user_id": uid, "password": "p", "balance_override": 10000}, timeout=15)
        # A fresh market order is a loser (negative because of commission + spread).
        requests.post(f"{API}/orders/place", json={
            "user_id": uid, "symbol": "EUR/USD", "side": "buy", "lots": 0.1,
        }, timeout=15)
        r = requests.post(f"{API}/orders/close_batch", json={
            "user_id": uid, "scope": "losers",
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["closed_count"] >= 1
        requests.delete(f"{API}/admin/users/{uid}", headers=headers)


# --- Section 8: Public settings + admin settings update --------------------
class TestSettings:
    def test_public_settings_default(self):
        r = requests.get(f"{API}/settings/public", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("broker_name", "broker_tagline", "broker_logo_url",
                  "allow_funds", "commission_per_lot"):
            assert k in body

    def test_admin_update_broker_name_and_funds(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.put(f"{API}/admin/settings", headers=headers,
            json={"broker_name": "TestBroker", "allow_funds": False}, timeout=15)
        assert r.status_code == 200, r.text
        pub = requests.get(f"{API}/settings/public", timeout=15).json()
        assert pub["broker_name"] == "TestBroker"
        assert pub["allow_funds"] is False
        # Restore for the FE tests + leave the system clean.
        r2 = requests.put(f"{API}/admin/settings", headers=headers,
            json={"broker_name": "ApexFX", "allow_funds": True}, timeout=15)
        assert r2.status_code == 200
        pub2 = requests.get(f"{API}/settings/public", timeout=15).json()
        assert pub2["broker_name"] == "ApexFX"
        assert pub2["allow_funds"] is True
