"""
End-to-end backend tests for the NEW ApexFX order-type features (iteration 2).
Covers:
  - market with TP/SL
  - limit with trigger price -> status pending
  - pending with expiry_minutes -> status pending + expires_at
  - positions endpoint returns BOTH open and pending
  - by_symbol filter
  - TP auto-close (poll loop closes within ~4s)
  - Cancel pending (close endpoint on a pending order)
"""
from __future__ import annotations

import os
import time

import pytest
import requests

_FRONTEND_ENV = "/app/frontend/.env"
BACKEND_URL = ""
if os.path.exists(_FRONTEND_ENV):
    with open(_FRONTEND_ENV) as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BACKEND_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL not configured"
API = f"{BACKEND_URL}/api"

USER_ID = "3245615"
PASSWORD = "Dhanu@41"


def _warm_prices():
    for _ in range(5):
        r = requests.get(f"{API}/prices", timeout=15)
        if r.status_code == 200 and r.json().get("data"):
            return r.json()["data"]
        time.sleep(2)
    raise RuntimeError("prices never warmed")


def _mid(symbol: str) -> float:
    data = _warm_prices()
    return float(data[symbol]["mid"])


@pytest.fixture(scope="module", autouse=True)
def _login():
    r = requests.post(
        f"{API}/auth/login",
        json={"user_id": USER_ID, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200
    yield


# -------------------- Market with TP/SL ------------------------------------
class TestMarketWithTPSL:
    """POST /api/orders/place with order_type market + target_price + stop_loss."""

    def test_market_tp_sl_stored(self):
        mid = _mid("EUR/USD")
        payload = {
            "user_id": USER_ID,
            "symbol": "EUR/USD",
            "side": "buy",
            "lots": 1.0,
            "order_type": "market",
            "target_price": round(mid + 0.5, 5),  # far away so it doesn't fire
            "stop_loss": round(mid - 0.5, 5),
        }
        r = requests.post(f"{API}/orders/place", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "open"
        assert order["order_type"] == "market"
        assert order["target_price"] == payload["target_price"]
        assert order["stop_loss"] == payload["stop_loss"]
        # Clean up
        requests.post(
            f"{API}/orders/close",
            json={"order_id": order["id"], "user_id": USER_ID},
            timeout=20,
        )


# -------------------- Limit order ------------------------------------------
class TestLimitOrder:
    def test_limit_order_is_pending_with_trigger(self):
        mid = _mid("EUR/USD")
        trigger = round(mid - 0.5, 5)  # buy limit below market -> stays pending
        payload = {
            "user_id": USER_ID,
            "symbol": "EUR/USD",
            "side": "buy",
            "lots": 1.0,
            "order_type": "limit",
            "price": trigger,
        }
        r = requests.post(f"{API}/orders/place", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "pending"
        assert order["order_type"] == "limit"
        assert order["trigger_price"] == trigger
        # cleanup
        requests.post(
            f"{API}/orders/close",
            json={"order_id": order["id"], "user_id": USER_ID},
            timeout=20,
        )


# -------------------- Pending order with expiry -----------------------------
class TestPendingWithExpiry:
    def test_pending_with_expiry_minutes(self):
        mid = _mid("EUR/USD")
        trigger = round(mid - 0.5, 5)
        payload = {
            "user_id": USER_ID,
            "symbol": "EUR/USD",
            "side": "buy",
            "lots": 1.0,
            "order_type": "pending",
            "price": trigger,
            "expiry_minutes": 30,
        }
        r = requests.post(f"{API}/orders/place", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "pending"
        assert order["order_type"] == "pending"
        assert order["trigger_price"] == trigger
        assert order["expires_at"], "expires_at missing"
        # Rough sanity: expires_at ~30 minutes from now
        from datetime import datetime, timezone
        exp = datetime.fromisoformat(order["expires_at"])
        delta_min = (exp - datetime.now(timezone.utc)).total_seconds() / 60.0
        assert 25 < delta_min < 35, f"expiry delta {delta_min:.1f} min not ~30"
        # cleanup
        requests.post(
            f"{API}/orders/close",
            json={"order_id": order["id"], "user_id": USER_ID},
            timeout=20,
        )


# -------------------- Positions includes pending ----------------------------
class TestPositionsIncludesPending:
    def test_positions_lists_open_and_pending(self):
        mid = _mid("EUR/USD")
        # 1 market (open), 1 limit (pending)
        m = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "market",
            },
            timeout=20,
        ).json()["order"]
        l = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "limit",
                "price": round(mid - 0.5, 5),
            },
            timeout=20,
        ).json()["order"]

        r = requests.get(f"{API}/orders/positions/{USER_ID}", timeout=20)
        assert r.status_code == 200
        positions = r.json()
        statuses = {p["id"]: p["status"] for p in positions}
        assert statuses.get(m["id"]) == "open"
        assert statuses.get(l["id"]) == "pending"
        # cleanup
        for oid in (m["id"], l["id"]):
            requests.post(
                f"{API}/orders/close",
                json={"order_id": oid, "user_id": USER_ID},
                timeout=20,
            )


# -------------------- By-symbol filter --------------------------------------
class TestBySymbol:
    def test_by_symbol_filters(self):
        # EUR/USD order
        o1 = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "market",
            },
            timeout=20,
        ).json()["order"]
        # GBP/USD order
        o2 = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "GBP/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "market",
            },
            timeout=20,
        ).json()["order"]

        r = requests.get(f"{API}/orders/by_symbol/{USER_ID}/EUR-USD", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        symbols = {row["symbol"] for row in rows}
        assert symbols == {"EUR/USD"}, f"got {symbols}"
        ids = [row["id"] for row in rows]
        assert o1["id"] in ids
        assert o2["id"] not in ids
        # cleanup
        for oid in (o1["id"], o2["id"]):
            requests.post(
                f"{API}/orders/close",
                json={"order_id": oid, "user_id": USER_ID},
                timeout=20,
            )


# -------------------- TP auto-close -----------------------------------------
class TestTakeProfitAutoClose:
    def test_tp_fires_and_moves_to_history(self):
        # Fetch bid directly - for buys TP compares to current bid.
        data = _warm_prices()
        bid = float(data["EUR/USD"]["bid"])
        # Set TP a hair below current bid so the loop closes immediately
        # on the next price tick.
        tp = round(bid - 0.0001, 5)
        r = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "market",
                "target_price": tp,
            },
            timeout=20,
        )
        assert r.status_code == 200
        order = r.json()["order"]
        oid = order["id"]

        # Wait up to ~10s for poll loop (2s cadence) to trip.
        found = None
        for _ in range(10):
            time.sleep(1.5)
            h = requests.get(f"{API}/orders/history/{USER_ID}", timeout=20).json()
            matches = [x for x in h if x["id"] == oid]
            if matches:
                found = matches[0]
                break
        assert found, "order did not auto-close within ~15s"
        assert found["status"] == "closed"
        assert found["close_reason"] == "take_profit"
        assert found["pnl"] is not None


# -------------------- Cancel pending ----------------------------------------
class TestCancelPending:
    def test_cancel_pending_sets_cancelled(self):
        mid = _mid("EUR/USD")
        r = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
                "order_type": "limit",
                "price": round(mid - 0.5, 5),  # won't trigger
            },
            timeout=20,
        )
        assert r.status_code == 200
        order = r.json()["order"]
        assert order["status"] == "pending"

        c = requests.post(
            f"{API}/orders/close",
            json={"order_id": order["id"], "user_id": USER_ID},
            timeout=20,
        )
        assert c.status_code == 200
        closed = c.json()["order"]
        assert closed["status"] == "cancelled"
        assert closed["close_reason"] == "manual"

        # Verify it shows up in history
        h = requests.get(f"{API}/orders/history/{USER_ID}", timeout=20).json()
        ids = [x["id"] for x in h]
        assert order["id"] in ids
