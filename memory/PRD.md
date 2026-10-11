# ApexFX Trading — Product Requirements

## Overview
A mobile Forex & Crypto trading app built in Expo (React Native) with a FastAPI
backend, plus a web-accessible Broker Admin panel. Live FastForex pricing,
TradingView charting, server-side risk management, and admin-controlled
branding.

## Trader features
1. **Login** – Trading ID + password. Logs the user in via local user table →
   CRM `login_api.php` → demo fallback.
2. **5 Bottom Tabs** – Watchlist · Chart · Positions · History · Settings.
3. **Watchlist** – Hot Movers strip, 14 live symbols, category chips, balance
   pill → Funds (hidden when admin disables funds).
4. **Chart** – Full-screen TradingView advanced widget. The app shows only the
   compact symbol selector + mode toggle; **timeframe selection lives inside
   TradingView's own toolbar**. Trade bar below: `[SELL] [Lot − / value / +]
   [BUY]`. Open positions panel below the trade bar.
5. **Trading modes** (persisted in local storage, toggled from Chart top bar
   or Settings): **One-Tap** fires market orders instantly, **Standard** opens
   the order ticket so the trader can set Take Profit / Stop Loss first.
6. **Order types**: Market · Limit · Stop · Pending (with expiry timer).
7. **Positions** – all open + pending orders, bulk-close bar with
   **Close All / Close Winners / Close Losers**, Trade more, Cancel order.
8. **History** – closed/cancelled trades with close reasons:
   `manual`, `take_profit`, `stop_loss`, `expired`, `liquidation`.
9. **Settings** – profile, balance, max lots, Deposit/Withdraw (hidden if
   admin disabled), trading-mode toggle, commission from settings, broker
   admin link.
10. **Funds** – Deposit/Withdraw with quick amounts and methods; hidden with a
    notice when admin disables funds.
11. **Blocked banner** – shown across every tab when equity ≤ 0; CTA takes the
    trader to the Deposit flow (if funds enabled).

## Server-side risk engine
- **Commission** = `commission_per_lot × lots` (default $20/lot; admin editable).
- **Max lots** = `max(0.01, balance ÷ $1,000)` — so $10 → 0.01, $100 → 0.10,
  $500 → 0.50, $800 → 0.80, $1,000 → 1, $10,000 → 10. Admin can override per
  user.
- **Balance** = `base (CRM/demo/admin-override) + fund adjustments + realised
  pnl of closed orders`. Closing a trade immediately moves the balance.
- **Equity** = `balance + floating pnl of open positions`.
- **Pending/limit/stop** orders auto-trigger when price hits the level; Take
  Profit / Stop Loss auto-close the position; expired pending orders
  auto-cancel; **liquidation** closes every open position when equity hits 0.
- Blocked accounts can't place new trades until a deposit lifts equity > 0.

## Admin panel (`/admin`)
- Password protected (`ADMIN_PASSWORD` env, default `admin123`); session
  bearer token stored in secure storage.
- **Users tab**: Create Trading ID + password with optional
  balance_override / max_lots_override, edit password / balance / max lots,
  remove account.
- **Branding & Settings tab**: broker name, tagline, logo URL, commission
  per lot, allow deposits/withdrawals toggle. Changes are reflected on the
  Login page and Settings tab after the next broker-settings refresh.

## Backend endpoints (`/api`)
- `GET /` – health
- `POST /auth/login`
- `GET /account/{user_id}` – balance, equity, floating/realised pnl, max_lots,
  blocked
- `POST /orders/place` (market/limit/stop/pending + TP/SL + expiry)
- `GET /orders/positions/{user_id}` · `GET /orders/by_symbol/{user_id}/{symbol}`
- `GET /orders/history/{user_id}` · `POST /orders/close` · `POST /orders/close_batch`
- `POST /funds/deposit` · `POST /funds/withdraw` · `GET /funds/history/{user_id}`
- `GET /prices` · `GET /prices/{symbol}` · `WS /ws/prices`
- `GET /settings/public`
- Admin: `POST /admin/login`, `GET/PUT /admin/settings`,
  `GET /admin/users`, `POST /admin/users`, `DELETE /admin/users/{user_id}`

## Integrations
- **TradingView** free widget (`https://s3.tradingview.com/tv.js`).
- **FastForex** (`/fetch-multi`) via a 2-second poll loop pushed to all
  WebSocket subscribers. Key in `backend/.env` as `FASTFOREX_API_KEY`.
- **CRM** – Best-effort forwarding to `login_api.php`, `accbal_api.php`,
  `ctrader_api.php`, `fund_api.php` at `wefundclient.com/Crm/Crm`. Demo
  fallback keeps the preview UI alive.

## Tech
- Expo SDK 57 · Expo Router · react-native-webview · react-native-reanimated
- react-native-keyboard-controller · react-native-safe-area-context
- `@react-native-vector-icons/material-design-icons`
- FastAPI + Motor + native WebSocket
