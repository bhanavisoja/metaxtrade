"""
End-to-end backend tests for ApexFX Trading backend.
Uses the public EXPO_PUBLIC_BACKEND_URL preview URL, hitting /api/* routes.
"""
import json
import os
import time

import pytest
import requests
import websocket  # websocket-client package

# Load the frontend .env to find the public URL (same URL the user sees).
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


# --- Health ----------------------------------------------------------------
class TestHealth:
    def test_health_ok(self):
        r = requests.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"


# --- Auth ------------------------------------------------------------------
class TestAuth:
    def test_login_demo_mode(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"user_id": USER_ID, "password": PASSWORD},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["user_id"] == USER_ID
        assert body["balance"] == 6000.0
        assert body["max_lots"] == 6.0


# --- Account ---------------------------------------------------------------
class TestAccount:
    def test_account_summary(self):
        r = requests.get(f"{API}/account/{USER_ID}", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == USER_ID
        assert body["balance"] == 6000.0
        assert body["max_lots"] == 6.0
        assert body["commission_per_lot"] == 20


# --- Prices ----------------------------------------------------------------
class TestPrices:
    def test_prices_snapshot(self):
        # Give the poll loop a moment on cold start.
        for _ in range(5):
            r = requests.get(f"{API}/prices", timeout=15)
            assert r.status_code == 200
            body = r.json()
            if body.get("data"):
                break
            time.sleep(2)
        assert "data" in body and "categories" in body
        assert len(body["data"]) == 14, f"expected 14 symbols, got {len(body['data'])}"
        cats = body["categories"]
        assert set(cats.keys()) == {"forex", "crypto", "metals"}
        # Spot-check an FX pair
        sample = body["data"].get("EUR/USD")
        assert sample and sample["bid"] > 0 and sample["ask"] > sample["bid"]


# --- Orders ----------------------------------------------------------------
class TestOrders:
    @classmethod
    def setup_class(cls):
        cls.order_id = None

    def test_place_order_exceeds_max(self):
        # Max is 6 lots for this balance; 10 must fail.
        r = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 10.0,
            },
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "exceeds max allowed" in r.json().get("detail", "")

    def test_place_order_success(self):
        # Ensure prices are warm.
        requests.get(f"{API}/prices", timeout=15)
        r = requests.post(
            f"{API}/orders/place",
            json={
                "user_id": USER_ID,
                "symbol": "EUR/USD",
                "side": "buy",
                "lots": 1.0,
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        order = body["order"]
        assert order["commission"] == 20.0
        assert order["status"] == "open"
        assert order["lots"] == 1.0
        TestOrders.order_id = order["id"]

    def test_positions_lists_order(self):
        assert TestOrders.order_id, "order not placed"
        time.sleep(2)  # let WS tick
        r = requests.get(f"{API}/orders/positions/{USER_ID}", timeout=20)
        assert r.status_code == 200
        positions = r.json()
        ids = [p["id"] for p in positions]
        assert TestOrders.order_id in ids
        p = next(p for p in positions if p["id"] == TestOrders.order_id)
        assert "current_price" in p and p["current_price"] > 0
        assert "pnl" in p

    def test_close_order_and_history(self):
        assert TestOrders.order_id, "order not placed"
        r = requests.post(
            f"{API}/orders/close",
            json={"order_id": TestOrders.order_id, "user_id": USER_ID},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "closed"
        assert order["close_price"] is not None
        assert order["closed_at"] is not None

        r2 = requests.get(f"{API}/orders/history/{USER_ID}", timeout=20)
        assert r2.status_code == 200
        hist_ids = [h["id"] for h in r2.json()]
        assert TestOrders.order_id in hist_ids


# --- WebSocket -------------------------------------------------------------
class TestWebSocket:
    def test_ws_snapshot_and_prices(self):
        ws_url = BACKEND_URL.replace("http://", "ws://").replace("https://", "wss://") + "/api/ws/prices"
        ws = websocket.create_connection(ws_url, timeout=15)
        try:
            ws.settimeout(10)
            first = json.loads(ws.recv())
            assert first["type"] == "snapshot"
            assert "data" in first and "categories" in first
            # Wait for a prices tick (~2s)
            got_prices = False
            for _ in range(5):
                msg = json.loads(ws.recv())
                if msg.get("type") == "prices":
                    got_prices = True
                    assert len(msg["data"]) > 0
                    break
            assert got_prices, "no prices event received"
        finally:
            ws.close()
