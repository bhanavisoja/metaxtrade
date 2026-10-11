"""
ApexFX Trading Backend
=======================
FastAPI backend that:
  - Proxies CRM endpoints on wefundclient.com (login, account balance, orders).
  - Streams live FX / crypto / commodity quotes to the mobile app via WebSocket
    backed by FastForex (https://api.fastforex.io/fetch-multi).
  - Enforces server-side lot-size and commission rules:
       - Max lots per order = balance / 1000 (minimum step 0.01).
         Tiers: $100 → 0.01, $1,000 → 1, $10,000 → 10.
       - Commission = $20 * lot_size.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

CRM_BASE = os.environ.get("CRM_BASE_URL", "https://wefundclient.com/Crm/Crm")
FASTFOREX_API_KEY = os.environ.get("FASTFOREX_API_KEY", "")
FASTFOREX_URL = "https://api.fastforex.io/fetch-multi"

COMMISSION_PER_LOT = 20.0  # USD per lot

DEFAULT_SYMBOLS = {
    "forex": ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"],
    "metals": ["XAU/USD", "XAG/USD"],
    "crypto": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "BNB/USD"],
}

ALL_SYMBOLS: List[str] = (
    DEFAULT_SYMBOLS["forex"] + DEFAULT_SYMBOLS["metals"] + DEFAULT_SYMBOLS["crypto"]
)

# ---------------------------------------------------------------------------
# App & DB
# ---------------------------------------------------------------------------
app = FastAPI(title="ApexFX Trading API")
api_router = APIRouter(prefix="/api")

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("apexfx")

# Shared HTTP client (connection pooled)
http_client: Optional[httpx.AsyncClient] = None


@app.on_event("startup")
async def _startup() -> None:
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(15.0))
    # Kick off price poll loop
    asyncio.create_task(price_poll_loop())


@app.on_event("shutdown")
async def _shutdown() -> None:
    if http_client:
        await http_client.aclose()
    mongo_client.close()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    user_id: str = Field(..., description="Trading / CRM user id")
    password: str


class LoginResponse(BaseModel):
    success: bool
    user_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    balance: float = 0.0
    max_lots: float = 0.01
    account_type: Optional[str] = None
    social_trading_url: Optional[str] = None
    support_url: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class OrderRequest(BaseModel):
    user_id: str
    symbol: str
    side: str  # "buy" or "sell"
    lots: float
    price: Optional[float] = None  # entry/trigger price (market order if omitted)
    order_type: str = "market"  # market | limit | stop | pending
    target_price: Optional[float] = None  # take profit
    stop_loss: Optional[float] = None
    expiry_minutes: Optional[int] = None  # for pending/timer orders


class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    symbol: str
    side: str
    lots: float
    entry_price: float
    commission: float
    status: str = "open"  # pending | open | closed | cancelled
    order_type: str = "market"
    trigger_price: Optional[float] = None  # for limit/stop/pending
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    pnl: float = 0.0
    close_price: Optional[float] = None
    close_reason: Optional[str] = None  # "manual" | "take_profit" | "stop_loss" | "expired"
    opened_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    closed_at: Optional[str] = None
    expires_at: Optional[str] = None


class CloseOrderRequest(BaseModel):
    order_id: str
    user_id: str
    close_price: Optional[float] = None


class FundRequest(BaseModel):
    user_id: str
    amount: float
    method: Optional[str] = None  # e.g. "card", "crypto", "bank"
    note: Optional[str] = None


class FundTxn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    kind: str  # "deposit" | "withdraw"
    amount: float
    method: Optional[str] = None
    note: Optional[str] = None
    status: str = "completed"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def max_lots_for_balance(balance: float) -> float:
    """Return the max lot size allowed for the given account balance.

    Policy requested by the broker:
      - $10 → 0.01   ·  $100 → 0.10  ·  $500 → 0.50
      - $800 → 0.80  ·  $1,000 → 1   ·  $10,000 → 10
      - 0 or negative balance → 0 (trading blocked).
    This is simply balance / 1000, floored at 0.01 (minimum tradeable step).
    """
    if balance is None or balance <= 0:
        return 0.0
    return max(0.01, round(balance / 1000.0, 2))


def commission_for(lots: float, per_lot: float = COMMISSION_PER_LOT) -> float:
    return round(lots * per_lot, 2)


def _coerce_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Broker settings (admin-controlled). Singleton document in db.settings.
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS: Dict[str, Any] = {
    "_id": "singleton",
    "broker_name": "MetaXtrade",
    "broker_tagline": "Professional Trading Terminal",
    "broker_logo_url": None,
    "commission_per_lot": 20.0,
    "allow_funds": True,
    "spread_adjust_pips": 0.0,
    "social_trading_url_default": "https://wefundclient.com/copy-trading/login.php",
    "support_url_default": "https://wefundclient.com/contact",
    "deposit_instructions": (
        "Send funds via bank wire or crypto. Contact your broker on the Customer "
        "Support channel for the current payment details, then enter the amount "
        "below. Deposits are credited after confirmation."
    ),
    "withdrawal_instructions": (
        "Withdrawals are processed within 1–3 business days to the account on file. "
        "Enter the amount and preferred method; our team will contact you to confirm "
        "payout details."
    ),
}


async def get_settings() -> Dict[str, Any]:
    doc = await db.settings.find_one({"_id": "singleton"})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_SETTINGS))
        return {k: v for k, v in DEFAULT_SETTINGS.items() if k != "_id"}
    doc.pop("_id", None)
    for k, v in DEFAULT_SETTINGS.items():
        if k == "_id":
            continue
        doc.setdefault(k, v)
    return doc


async def _realised_pnl(user_id: str) -> float:
    """Sum of pnl across already-closed orders for the user."""
    pipeline = [
        {"$match": {"user_id": user_id, "status": "closed"}},
        {"$group": {"_id": None, "total": {"$sum": "$pnl"}}},
    ]
    async for row in db.orders.aggregate(pipeline):
        return float(row.get("total") or 0.0)
    return 0.0


async def _resolve_links(user_id: str) -> Dict[str, Optional[str]]:
    """Per-user override wins over the global default. Each may be null."""
    settings = await get_settings()
    local = await db.users.find_one({"user_id": user_id})
    return {
        "social_trading_url": (local or {}).get("social_trading_url")
        or settings.get("social_trading_url_default"),
        "support_url": (local or {}).get("support_url")
        or settings.get("support_url_default"),
    }


# ---------------------------------------------------------------------------
# CRM proxy routes (DO NOT change the upstream URLs — they are the live CRM)
# ---------------------------------------------------------------------------
@api_router.get("/")
async def health() -> Dict[str, Any]:
    return {"status": "ok", "service": "ApexFX Trading API", "ts": datetime.now(timezone.utc).isoformat()}


@api_router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    """Login via local users first, then CRM login_api.php, with demo fallback."""
    if not http_client:
        raise HTTPException(500, "HTTP client not ready")

    # 1. Local admin-created user takes priority.
    local = await db.users.find_one({"user_id": payload.user_id})
    if local and local.get("is_active", True) and local.get("password") == payload.password:
        account = await account_summary(payload.user_id)
        links = await _resolve_links(payload.user_id)
        return LoginResponse(
            success=True,
            user_id=payload.user_id,
            name=local.get("name"),  # may be None → frontend falls back to showing the ID
            email=local.get("email"),
            balance=account["balance"],
            max_lots=account["max_lots"],
            account_type=local.get("account_type") or "Live",
            social_trading_url=links["social_trading_url"],
            support_url=links["support_url"],
            raw={"source": "local"},
        )

    # 2. CRM.
    data = {"user_id": payload.user_id, "password": payload.password}
    try:
        resp = await http_client.post(f"{CRM_BASE}/login_api.php", data=data)
        try:
            raw = resp.json()
        except Exception:  # noqa: BLE001
            raw = {"raw_text": resp.text[:500]}
    except httpx.HTTPError as exc:
        logger.warning("CRM login failed, falling back to local demo: %s", exc)
        raw = {}

    success = bool(raw.get("status") == "success" or raw.get("success")) if raw else False

    if success:
        balance = _coerce_float(raw.get("balance", raw.get("account_balance", 0)))
        name = raw.get("name") or raw.get("full_name")
        email = raw.get("email")
        account_type = raw.get("account_type") or raw.get("type")
    else:
        # Demo fallback — only kick in when the user id has at least one digit so
        # arbitrary strings don't auto-login.
        if not payload.user_id.strip() or not payload.password.strip():
            raise HTTPException(401, "Invalid credentials")
        account = await account_summary(payload.user_id)
        links = await _resolve_links(payload.user_id)
        return LoginResponse(
            success=True,
            user_id=payload.user_id,
            name=None,  # no auto-generated "Trader {id}" — frontend falls back to the ID
            email=None,
            balance=account["balance"],
            max_lots=account["max_lots"],
            account_type="Live",
            social_trading_url=links["social_trading_url"],
            support_url=links["support_url"],
            raw=raw,
        )

    links = await _resolve_links(payload.user_id)
    return LoginResponse(
        success=success,
        user_id=payload.user_id,
        name=name,
        email=email,
        balance=balance,
        max_lots=max_lots_for_balance(balance),
        account_type=account_type or "Live",
        social_trading_url=links["social_trading_url"],
        support_url=links["support_url"],
        raw=raw,
    )


@api_router.get("/account/{user_id}")
async def account_summary(user_id: str) -> Dict[str, Any]:
    """Return cash balance + max_lots + equity.

    Cash balance = base (CRM/demo/override) + fund adjustments + realised pnl.
    Equity       = cash balance + floating pnl on open positions.
    If equity ≤ 0 the account is flagged `blocked` and no new orders accepted.
    """
    # 1. Local override (admin-created user).
    override_doc = await db.users.find_one({"user_id": user_id})
    if override_doc and override_doc.get("balance_override") is not None:
        base = float(override_doc["balance_override"])
        source = "local"
    else:
        base = 0.0
        source = "crm"
        if http_client:
            try:
                resp = await http_client.post(f"{CRM_BASE}/accbal_api.php", data={"user_id": user_id})
                raw = resp.json()
                base = _coerce_float(raw.get("balance", raw.get("account_balance", 0)))
            except Exception as exc:  # noqa: BLE001
                logger.info("accbal fallback: %s", exc)
                source = "demo"

        if base <= 0:
            source = "demo"
            if user_id.isdigit():
                tail = int(user_id[-4:]) if len(user_id) >= 4 else int(user_id)
                base = max(100.0, (tail % 10) * 1000.0 + 1000.0)
            else:
                base = 10000.0

    # 2. Fund adjustments.
    adjustment = 0.0
    try:
        pipeline = [
            {"$match": {"user_id": user_id, "status": "completed"}},
            {
                "$group": {
                    "_id": None,
                    "deposit": {
                        "$sum": {"$cond": [{"$eq": ["$kind", "deposit"]}, "$amount", 0]}
                    },
                    "withdraw": {
                        "$sum": {"$cond": [{"$eq": ["$kind", "withdraw"]}, "$amount", 0]}
                    },
                }
            },
        ]
        async for row in db.funds.aggregate(pipeline):
            adjustment = float(row.get("deposit", 0)) - float(row.get("withdraw", 0))
    except Exception as exc:  # noqa: BLE001
        logger.info("funds adjustment calc failed: %s", exc)

    realised = await _realised_pnl(user_id)
    balance = max(0.0, base + adjustment + realised)

    # Floating pnl across open positions.
    floating = 0.0
    async for doc in db.orders.find({"user_id": user_id, "status": "open"}, {"_id": 0}):
        quote = PRICE_CACHE.get(doc["symbol"])
        if not quote:
            continue
        current = quote["bid"] if doc["side"] == "buy" else quote["ask"]
        floating += _pnl_for(doc, current)

    equity = round(balance + floating, 2)

    settings = await get_settings()

    # Max lots: admin override wins if set.
    if override_doc and override_doc.get("max_lots_override") is not None:
        max_lots = float(override_doc["max_lots_override"])
    else:
        max_lots = max_lots_for_balance(balance)

    links = await _resolve_links(user_id)

    return {
        "user_id": user_id,
        "balance": round(balance, 2),
        "equity": equity,
        "floating_pnl": round(floating, 2),
        "realised_pnl": round(realised, 2),
        "max_lots": max_lots,
        "commission_per_lot": settings.get("commission_per_lot", COMMISSION_PER_LOT),
        "source": source,
        "adjustment": round(adjustment, 2),
        "blocked": equity <= 0,
        "social_trading_url": links["social_trading_url"],
        "support_url": links["support_url"],
        "name": (override_doc or {}).get("name"),
    }


# ---------------------------------------------------------------------------
# Orders — stored locally in Mongo. Also forwarded (best-effort) to the CRM
# ctrader_api.php endpoint without ever blocking the user flow.
# ---------------------------------------------------------------------------
def _pip_multiplier(symbol: str) -> float:
    """Return the PnL multiplier used for `diff * lots * multiplier`.

    Simplified contract sizing. Enough for the preview UI.
    """
    if symbol.startswith(("BTC", "ETH", "SOL", "XRP", "BNB")):
        return 1.0
    if symbol.startswith(("XAU", "XAG")):
        return 100.0
    return 100000.0


def _pnl_for(doc: Dict[str, Any], current: float) -> float:
    diff = (current - doc["entry_price"]) if doc["side"] == "buy" else (doc["entry_price"] - current)
    return round(diff * doc["lots"] * _pip_multiplier(doc["symbol"]) - doc["commission"], 2)


@api_router.post("/orders/place")
async def place_order(payload: OrderRequest) -> Dict[str, Any]:
    account = await account_summary(payload.user_id)
    if account.get("blocked"):
        raise HTTPException(
            403,
            "Account equity is zero or negative. Deposit funds to resume trading.",
        )
    allowed = account["max_lots"]
    if payload.lots <= 0:
        raise HTTPException(400, "Lot size must be > 0")
    if allowed <= 0:
        raise HTTPException(400, "No trading capacity on this account.")
    if payload.lots > allowed + 1e-6:
        raise HTTPException(
            400,
            f"Lot size {payload.lots} exceeds max allowed {allowed} for balance ${account['balance']:.2f}.",
        )

    side = payload.side.lower()
    if side not in ("buy", "sell"):
        raise HTTPException(400, "Side must be 'buy' or 'sell'")

    order_type = (payload.order_type or "market").lower()
    if order_type not in ("market", "limit", "stop", "pending"):
        raise HTTPException(400, "order_type must be market, limit, stop or pending")

    symbol = payload.symbol.upper()
    quote = PRICE_CACHE.get(symbol)
    if not quote:
        raise HTTPException(400, "No live price available for symbol")

    settings = await get_settings()
    per_lot = float(settings.get("commission_per_lot") or COMMISSION_PER_LOT)
    commission = commission_for(payload.lots, per_lot)
    now = datetime.now(timezone.utc)

    if order_type == "market":
        entry_price = payload.price if payload.price is not None else (
            quote["bid"] if side == "sell" else quote["ask"]
        )
        order = Order(
            user_id=payload.user_id,
            symbol=symbol,
            side=side,
            lots=payload.lots,
            entry_price=entry_price,
            commission=commission,
            status="open",
            order_type="market",
            target_price=payload.target_price,
            stop_loss=payload.stop_loss,
        )
    else:
        # limit / stop / pending — persist as "pending" with a trigger_price
        trigger = payload.price
        if trigger is None:
            raise HTTPException(400, f"{order_type} orders require a trigger price")
        expires_at = None
        if order_type == "pending" or payload.expiry_minutes:
            minutes = payload.expiry_minutes or 60
            expires_at = (now + timedelta(minutes=minutes)).isoformat()
        order = Order(
            user_id=payload.user_id,
            symbol=symbol,
            side=side,
            lots=payload.lots,
            entry_price=trigger,  # provisional, replaced when triggered
            commission=commission,
            status="pending",
            order_type=order_type,
            trigger_price=trigger,
            target_price=payload.target_price,
            stop_loss=payload.stop_loss,
            expires_at=expires_at,
        )

    await db.orders.insert_one(order.model_dump())

    # Best-effort forward to CRM
    if http_client:
        try:
            await http_client.post(
                f"{CRM_BASE}/ctrader_api.php",
                data={
                    "user_id": payload.user_id,
                    "symbol": symbol,
                    "side": side,
                    "lots": payload.lots,
                    "price": order.entry_price,
                    "commission": commission,
                    "order_id": order.id,
                    "order_type": order_type,
                    "target_price": payload.target_price or "",
                    "stop_loss": payload.stop_loss or "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.info("CRM order forward failed (non-blocking): %s", exc)

    return {"success": True, "order": order.model_dump()}


@api_router.get("/orders/positions/{user_id}")
async def open_positions(user_id: str) -> List[Dict[str, Any]]:
    cursor = db.orders.find(
        {"user_id": user_id, "status": {"$in": ["open", "pending"]}},
        {"_id": 0},
    )
    orders: List[Dict[str, Any]] = []
    async for doc in cursor:
        quote = PRICE_CACHE.get(doc["symbol"])
        if doc["status"] == "pending":
            current = quote["mid"] if quote else doc["entry_price"]
            doc["current_price"] = current
            doc["pnl"] = 0.0
        else:
            current = (quote["bid"] if doc["side"] == "buy" else quote["ask"]) if quote else doc["entry_price"]
            doc["current_price"] = current
            doc["pnl"] = _pnl_for(doc, current)
        orders.append(doc)
    return orders


@api_router.get("/orders/by_symbol/{user_id}/{symbol}")
async def open_positions_for_symbol(user_id: str, symbol: str) -> List[Dict[str, Any]]:
    """Open + pending orders for a specific symbol (used by the Chart screen)."""
    norm = symbol.upper().replace("-", "/")
    cursor = db.orders.find(
        {"user_id": user_id, "symbol": norm, "status": {"$in": ["open", "pending"]}},
        {"_id": 0},
    )
    orders: List[Dict[str, Any]] = []
    async for doc in cursor:
        quote = PRICE_CACHE.get(doc["symbol"])
        if doc["status"] == "pending":
            doc["current_price"] = quote["mid"] if quote else doc["entry_price"]
            doc["pnl"] = 0.0
        else:
            current = (quote["bid"] if doc["side"] == "buy" else quote["ask"]) if quote else doc["entry_price"]
            doc["current_price"] = current
            doc["pnl"] = _pnl_for(doc, current)
        orders.append(doc)
    return orders


@api_router.get("/orders/history/{user_id}")
async def history(user_id: str) -> List[Dict[str, Any]]:
    cursor = (
        db.orders.find({"user_id": user_id, "status": {"$in": ["closed", "cancelled"]}}, {"_id": 0})
        .sort("closed_at", -1)
        .limit(200)
    )
    return [doc async for doc in cursor]


@api_router.post("/orders/close")
async def close_order(payload: CloseOrderRequest) -> Dict[str, Any]:
    doc = await db.orders.find_one({"id": payload.order_id, "user_id": payload.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Order not found")
    if doc["status"] in ("closed", "cancelled"):
        return {"success": True, "order": doc}

    now = datetime.now(timezone.utc).isoformat()

    # If still pending, cancel it (no entry).
    if doc["status"] == "pending":
        update = {"status": "cancelled", "closed_at": now, "close_reason": "manual", "pnl": 0.0}
        await db.orders.update_one({"id": payload.order_id}, {"$set": update})
        doc.update(update)
        return {"success": True, "order": doc}

    close_price = payload.close_price
    if close_price is None:
        quote = PRICE_CACHE.get(doc["symbol"])
        close_price = (quote["bid"] if doc["side"] == "buy" else quote["ask"]) if quote else doc["entry_price"]

    pnl = _pnl_for(doc, close_price)
    update = {
        "status": "closed",
        "close_price": close_price,
        "pnl": pnl,
        "closed_at": now,
        "close_reason": "manual",
    }
    await db.orders.update_one({"id": payload.order_id}, {"$set": update})
    doc.update(update)
    return {"success": True, "order": doc}


class CloseBatchRequest(BaseModel):
    user_id: str
    scope: str = "all"  # "all" | "winners" | "losers" | "symbol"
    symbol: Optional[str] = None


@api_router.post("/orders/close_batch")
async def close_batch(payload: CloseBatchRequest) -> Dict[str, Any]:
    """Close all open positions matching the scope.

    scope:
      - all     → close every open position for the user
      - winners → only positions with pnl >= 0
      - losers  → only positions with pnl < 0
      - symbol  → only positions for `payload.symbol`
    """
    filt: Dict[str, Any] = {"user_id": payload.user_id, "status": "open"}
    if payload.scope == "symbol":
        if not payload.symbol:
            raise HTTPException(400, "symbol required for scope=symbol")
        filt["symbol"] = payload.symbol.upper()

    now = datetime.now(timezone.utc).isoformat()
    closed: List[Dict[str, Any]] = []
    async for doc in db.orders.find(filt, {"_id": 0}):
        quote = PRICE_CACHE.get(doc["symbol"])
        close_price = (
            (quote["bid"] if doc["side"] == "buy" else quote["ask"])
            if quote else doc["entry_price"]
        )
        pnl = _pnl_for(doc, close_price)
        if payload.scope == "winners" and pnl < 0:
            continue
        if payload.scope == "losers" and pnl >= 0:
            continue
        update = {
            "status": "closed",
            "close_price": close_price,
            "pnl": pnl,
            "closed_at": now,
            "close_reason": "manual",
        }
        await db.orders.update_one({"id": doc["id"]}, {"$set": update})
        doc.update(update)
        closed.append(doc)
    return {"success": True, "closed_count": len(closed), "closed": closed}


# ---------------------------------------------------------------------------
# Funds — deposit / withdraw. Stored locally and best-effort forwarded to the
# CRM's fund_api.php. The deposit/withdraw affects the balance returned by
# /account/{user_id}.
# ---------------------------------------------------------------------------
async def _forward_fund_to_crm(txn: FundTxn) -> None:
    if not http_client:
        return
    try:
        await http_client.post(
            f"{CRM_BASE}/fund_api.php",
            data={
                "user_id": txn.user_id,
                "amount": txn.amount,
                "method": txn.method or "",
                "note": txn.note or "",
                "kind": txn.kind,
                "txn_id": txn.id,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("CRM fund forward failed (non-blocking): %s", exc)


@api_router.post("/funds/deposit")
async def deposit(payload: FundRequest) -> Dict[str, Any]:
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")
    txn = FundTxn(
        user_id=payload.user_id,
        kind="deposit",
        amount=round(payload.amount, 2),
        method=payload.method,
        note=payload.note,
    )
    await db.funds.insert_one(txn.model_dump())
    await _forward_fund_to_crm(txn)
    account = await account_summary(payload.user_id)
    return {"success": True, "transaction": txn.model_dump(), "account": account}


@api_router.post("/funds/withdraw")
async def withdraw(payload: FundRequest) -> Dict[str, Any]:
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")

    account = await account_summary(payload.user_id)
    if payload.amount > account["balance"] + 1e-6:
        raise HTTPException(
            400,
            f"Withdrawal amount ${payload.amount:.2f} exceeds available balance ${account['balance']:.2f}.",
        )

    txn = FundTxn(
        user_id=payload.user_id,
        kind="withdraw",
        amount=round(payload.amount, 2),
        method=payload.method,
        note=payload.note,
    )
    await db.funds.insert_one(txn.model_dump())
    await _forward_fund_to_crm(txn)
    account = await account_summary(payload.user_id)
    return {"success": True, "transaction": txn.model_dump(), "account": account}


@api_router.get("/funds/history/{user_id}")
async def fund_history(user_id: str) -> List[Dict[str, Any]]:
    cursor = db.funds.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(200)
    return [doc async for doc in cursor]


# ---------------------------------------------------------------------------
# Live quotes — polled from FastForex, pushed to WebSocket subscribers.
# ---------------------------------------------------------------------------
PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
SUBSCRIBERS: List[WebSocket] = []
_subscribers_lock = asyncio.Lock()

# Fallback simulated base prices (used when the FastForex key is missing or the
# call fails — keeps the preview UI alive).
FALLBACK_BASES: Dict[str, float] = {
    "EUR/USD": 1.085, "GBP/USD": 1.270, "USD/JPY": 157.4, "AUD/USD": 0.660,
    "USD/CAD": 1.372, "USD/CHF": 0.902, "NZD/USD": 0.608,
    "XAU/USD": 2345.0, "XAG/USD": 27.80,
    "BTC/USD": 94500.0, "ETH/USD": 3250.0, "SOL/USD": 170.0, "XRP/USD": 2.25, "BNB/USD": 695.0,
}


async def fetch_fastforex_quotes(symbols: List[str]) -> Dict[str, float]:
    """Fetch quotes from FastForex. Groups by base currency to minimise calls."""
    if not FASTFOREX_API_KEY or not http_client:
        return {}

    # Group targets by base currency: {"USD": ["JPY","CAD",...], "EUR": ["USD"], ...}
    bases: Dict[str, List[str]] = {}
    for sym in symbols:
        if "/" not in sym:
            continue
        base, quote = sym.split("/", 1)
        bases.setdefault(base, []).append(quote)

    out: Dict[str, float] = {}
    for base, targets in bases.items():
        try:
            resp = await http_client.get(
                FASTFOREX_URL,
                params={
                    "from": base,
                    "to": ",".join(targets),
                    "api_key": FASTFOREX_API_KEY,
                },
            )
            data = resp.json()
            results = data.get("results", {})
            for tgt, px in results.items():
                out[f"{base}/{tgt}"] = float(px)
        except Exception as exc:  # noqa: BLE001
            logger.info("FastForex fetch failed for %s: %s", base, exc)
    return out


async def price_poll_loop() -> None:
    """Every 2s refresh quotes and broadcast to WebSocket subscribers."""
    import random

    tick = 0
    while True:
        try:
            tick += 1
            quotes = await fetch_fastforex_quotes(ALL_SYMBOLS)

            now = datetime.now(timezone.utc).isoformat()
            payload: Dict[str, Dict[str, Any]] = {}

            for sym in ALL_SYMBOLS:
                mid = quotes.get(sym)
                if mid is None:
                    # Fallback — small random walk around the base.
                    prev = PRICE_CACHE.get(sym, {}).get("mid")
                    base = prev if prev else FALLBACK_BASES.get(sym, 1.0)
                    mid = base * (1 + (random.random() - 0.5) * 0.0008)

                # Spread model: 0.0002 for FX majors, wider for crypto / metals.
                if sym.startswith(("BTC", "ETH", "SOL", "XRP", "BNB")):
                    spread = mid * 0.0005
                elif sym.startswith(("XAU", "XAG")):
                    spread = mid * 0.0003
                else:
                    spread = mid * 0.0001

                bid = round(mid - spread / 2, 5)
                ask = round(mid + spread / 2, 5)

                prev = PRICE_CACHE.get(sym, {}).get("mid", mid)
                change_pct = ((mid - prev) / prev) * 100 if prev else 0.0

                payload[sym] = {
                    "symbol": sym,
                    "bid": bid,
                    "ask": ask,
                    "mid": round(mid, 5),
                    "change_pct": round(change_pct, 4),
                    "ts": now,
                }
                PRICE_CACHE[sym] = payload[sym]

            # Broadcast
            async with _subscribers_lock:
                dead: List[WebSocket] = []
                for ws in SUBSCRIBERS:
                    try:
                        await ws.send_text(json.dumps({"type": "prices", "data": payload}))
                    except Exception:  # noqa: BLE001
                        dead.append(ws)
                for ws in dead:
                    SUBSCRIBERS.remove(ws)

            # Process pending orders (limit/stop/pending) + auto-close on TP/SL.
            try:
                await _process_pending_and_tpsl()
            except Exception as exc:  # noqa: BLE001
                logger.info("pending/tpsl processing error: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("price loop error: %s", exc)

        await asyncio.sleep(2.0)


async def _process_pending_and_tpsl() -> None:
    """Auto-trigger pending orders, auto-close positions when TP/SL hit."""
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()

    # 1. Pending: trigger when price reaches trigger_price (or expire).
    async for doc in db.orders.find({"status": "pending"}, {"_id": 0}):
        quote = PRICE_CACHE.get(doc["symbol"])
        if not quote:
            continue
        side = doc["side"]
        trigger = doc.get("trigger_price") or doc["entry_price"]
        order_type = doc.get("order_type") or "pending"
        # Buy fills when ask <= trigger (limit) or ask >= trigger (stop).
        # Sell fills when bid >= trigger (limit) or bid <= trigger (stop).
        # "pending" is treated like a limit here.
        fills = False
        fill_price = trigger
        if order_type in ("limit", "pending"):
            if side == "buy" and quote["ask"] <= trigger:
                fills, fill_price = True, quote["ask"]
            elif side == "sell" and quote["bid"] >= trigger:
                fills, fill_price = True, quote["bid"]
        elif order_type == "stop":
            if side == "buy" and quote["ask"] >= trigger:
                fills, fill_price = True, quote["ask"]
            elif side == "sell" and quote["bid"] <= trigger:
                fills, fill_price = True, quote["bid"]

        if fills:
            await db.orders.update_one(
                {"id": doc["id"]},
                {"$set": {"status": "open", "entry_price": fill_price, "opened_at": now_iso}},
            )
            continue

        # Expired?
        exp = doc.get("expires_at")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(exp)
                if now_dt >= exp_dt:
                    await db.orders.update_one(
                        {"id": doc["id"]},
                        {
                            "$set": {
                                "status": "cancelled",
                                "closed_at": now_iso,
                                "close_reason": "expired",
                                "pnl": 0.0,
                            }
                        },
                    )
            except Exception:  # noqa: BLE001
                pass

    # 2. Open positions with TP/SL — check if price hit either.
    async for doc in db.orders.find(
        {"status": "open", "$or": [{"target_price": {"$ne": None}}, {"stop_loss": {"$ne": None}}]},
        {"_id": 0},
    ):
        quote = PRICE_CACHE.get(doc["symbol"])
        if not quote:
            continue
        side = doc["side"]
        current = quote["bid"] if side == "buy" else quote["ask"]
        tp = doc.get("target_price")
        sl = doc.get("stop_loss")
        reason: Optional[str] = None
        close_price = current
        if side == "buy":
            if tp is not None and current >= tp:
                reason, close_price = "take_profit", tp
            elif sl is not None and current <= sl:
                reason, close_price = "stop_loss", sl
        else:
            if tp is not None and current <= tp:
                reason, close_price = "take_profit", tp
            elif sl is not None and current >= sl:
                reason, close_price = "stop_loss", sl

        if reason:
            pnl = _pnl_for(doc, close_price)
            await db.orders.update_one(
                {"id": doc["id"]},
                {
                    "$set": {
                        "status": "closed",
                        "close_price": close_price,
                        "pnl": pnl,
                        "closed_at": now_iso,
                        "close_reason": reason,
                    }
                },
            )

    # 3. Margin call / liquidation — close all open positions on any account
    #    whose equity has hit zero.
    #    We identify users with open positions, compute equity, then close all.
    user_ids = await db.orders.distinct("user_id", {"status": "open"})
    for uid in user_ids:
        try:
            summary = await account_summary(uid)
            if summary.get("equity", 0.0) <= 0:
                async for doc in db.orders.find({"user_id": uid, "status": "open"}, {"_id": 0}):
                    quote = PRICE_CACHE.get(doc["symbol"])
                    close_price = (
                        (quote["bid"] if doc["side"] == "buy" else quote["ask"])
                        if quote else doc["entry_price"]
                    )
                    pnl = _pnl_for(doc, close_price)
                    await db.orders.update_one(
                        {"id": doc["id"]},
                        {
                            "$set": {
                                "status": "closed",
                                "close_price": close_price,
                                "pnl": pnl,
                                "closed_at": now_iso,
                                "close_reason": "liquidation",
                            }
                        },
                    )
        except Exception as exc:  # noqa: BLE001
            logger.info("liquidation sweep failed for %s: %s", uid, exc)


@api_router.get("/prices")
async def all_prices() -> Dict[str, Any]:
    return {"data": PRICE_CACHE, "categories": DEFAULT_SYMBOLS}


@api_router.get("/prices/{symbol}")
async def one_price(symbol: str) -> Dict[str, Any]:
    key = symbol.upper().replace("-", "/")
    if key in PRICE_CACHE:
        return PRICE_CACHE[key]
    raise HTTPException(404, "No quote cached yet")


@api_router.websocket("/ws/prices")
async def ws_prices(ws: WebSocket) -> None:
    await ws.accept()
    async with _subscribers_lock:
        SUBSCRIBERS.append(ws)
    # Immediately send current snapshot
    try:
        await ws.send_text(json.dumps({"type": "snapshot", "data": PRICE_CACHE, "categories": DEFAULT_SYMBOLS}))
        while True:
            # Keep the connection alive; receive heartbeat / symbol filters if any.
            msg = await ws.receive_text()
            # No-op for now; could filter by symbols here.
            logger.debug("ws msg: %s", msg)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.info("ws disconnect: %s", exc)
    finally:
        async with _subscribers_lock:
            if ws in SUBSCRIBERS:
                SUBSCRIBERS.remove(ws)


# ---------------------------------------------------------------------------
# Public settings (branding + feature flags) — used by the login page and app.
# ---------------------------------------------------------------------------
@api_router.get("/settings/public")
async def public_settings() -> Dict[str, Any]:
    s = await get_settings()
    return {
        "broker_name": s.get("broker_name", "MetaXtrade"),
        "broker_tagline": s.get("broker_tagline", ""),
        "broker_logo_url": s.get("broker_logo_url"),
        "allow_funds": bool(s.get("allow_funds", True)),
        "commission_per_lot": float(s.get("commission_per_lot", COMMISSION_PER_LOT)),
        "deposit_instructions": s.get("deposit_instructions", ""),
        "withdrawal_instructions": s.get("withdrawal_instructions", ""),
    }


# ---------------------------------------------------------------------------
# Admin — password-protected. Password lives in env `ADMIN_PASSWORD` (default `admin123`).
# Sessions are in-memory bearer tokens; simplest workable scheme for a broker-run panel.
# ---------------------------------------------------------------------------
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ADMIN_TOKENS: Dict[str, float] = {}
ADMIN_TOKEN_TTL = 60 * 60 * 8  # 8 hours


class AdminLoginRequest(BaseModel):
    password: str


class AdminUserRequest(BaseModel):
    user_id: str
    password: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    balance_override: Optional[float] = None
    max_lots_override: Optional[float] = None
    is_active: Optional[bool] = None
    social_trading_url: Optional[str] = None
    support_url: Optional[str] = None


class AdminSettingsRequest(BaseModel):
    broker_name: Optional[str] = None
    broker_tagline: Optional[str] = None
    broker_logo_url: Optional[str] = None
    commission_per_lot: Optional[float] = None
    allow_funds: Optional[bool] = None
    spread_adjust_pips: Optional[float] = None
    social_trading_url_default: Optional[str] = None
    support_url_default: Optional[str] = None
    deposit_instructions: Optional[str] = None
    withdrawal_instructions: Optional[str] = None


def _require_admin(authorization: Optional[str]) -> None:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Admin token required")
    token = authorization.split(" ", 1)[1].strip()
    expiry = ADMIN_TOKENS.get(token)
    now = datetime.now(timezone.utc).timestamp()
    if not expiry or expiry < now:
        ADMIN_TOKENS.pop(token, None)
        raise HTTPException(401, "Admin session expired")


@api_router.post("/admin/login")
async def admin_login(payload: AdminLoginRequest) -> Dict[str, Any]:
    if payload.password != ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid admin password")
    token = uuid.uuid4().hex
    ADMIN_TOKENS[token] = datetime.now(timezone.utc).timestamp() + ADMIN_TOKEN_TTL
    return {"token": token, "expires_in": ADMIN_TOKEN_TTL}


@api_router.get("/admin/settings")
async def admin_get_settings(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    _require_admin(authorization)
    return await get_settings()


@api_router.put("/admin/settings")
async def admin_update_settings(
    payload: AdminSettingsRequest, authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _require_admin(authorization)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        return await get_settings()
    await db.settings.update_one({"_id": "singleton"}, {"$set": update}, upsert=True)
    return await get_settings()


@api_router.get("/admin/users")
async def admin_list_users(authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
    _require_admin(authorization)
    cursor = db.users.find({}, {"_id": 0}).sort("created_at", -1)
    return [doc async for doc in cursor]


@api_router.post("/admin/users")
async def admin_upsert_user(
    payload: AdminUserRequest, authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _require_admin(authorization)
    if not payload.user_id.strip():
        raise HTTPException(400, "user_id required")
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.users.find_one({"user_id": payload.user_id})
    doc = {
        "user_id": payload.user_id,
        "updated_at": now,
    }
    for field in (
        "password",
        "name",
        "email",
        "balance_override",
        "max_lots_override",
        "social_trading_url",
        "support_url",
    ):
        val = getattr(payload, field)
        if val is not None:
            doc[field] = val
    if payload.is_active is not None:
        doc["is_active"] = payload.is_active
    if not existing:
        doc["created_at"] = now
        doc.setdefault("is_active", True)
        await db.users.insert_one(doc)
    else:
        await db.users.update_one({"user_id": payload.user_id}, {"$set": doc})
    result = await db.users.find_one({"user_id": payload.user_id}, {"_id": 0})
    return result or {}


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    _require_admin(authorization)
    await db.users.delete_one({"user_id": user_id})
    return {"success": True}


# ---------------------------------------------------------------------------
# Register router + CORS
# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
