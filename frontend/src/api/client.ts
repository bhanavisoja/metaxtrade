// Centralised API client for the ApexFX trading backend.
// Uses EXPO_PUBLIC_BACKEND_URL from .env (never hardcode).

const RAW = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
export const BACKEND_URL = RAW.replace(/\/+$/, "");
export const API_BASE = `${BACKEND_URL}/api`;

export type LoginPayload = { user_id: string; password: string };
export type LoginResponse = {
  success: boolean;
  user_id: string;
  name?: string | null;
  email?: string | null;
  balance: number;
  max_lots: number;
  account_type?: string | null;
  social_trading_url?: string | null;
  support_url?: string | null;
  message?: string | null;
};

export type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  change_pct: number;
  ts: string;
};

export type QuotesSnapshot = {
  data: Record<string, Quote>;
  categories: { forex: string[]; crypto: string[]; metals: string[] };
};

export type Order = {
  id: string;
  user_id: string;
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  entry_price: number;
  commission: number;
  status: "open" | "pending" | "closed" | "cancelled";
  order_type?: "market" | "limit" | "stop" | "pending";
  trigger_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  pnl: number;
  current_price?: number;
  close_price?: number | null;
  close_reason?: string | null;
  opened_at: string;
  closed_at?: string | null;
  expires_at?: string | null;
};

export type AccountSummary = {
  user_id: string;
  balance: number;
  equity: number;
  floating_pnl: number;
  realised_pnl: number;
  max_lots: number;
  commission_per_lot: number;
  source: string;
  adjustment?: number;
  blocked?: boolean;
  social_trading_url?: string | null;
  support_url?: string | null;
  name?: string | null;
};

export type PublicSettings = {
  broker_name: string;
  broker_tagline?: string;
  broker_logo_url: string | null;
  allow_funds: boolean;
  commission_per_lot: number;
  deposit_instructions?: string;
  withdrawal_instructions?: string;
};

export type AdminUser = {
  user_id: string;
  password?: string;
  name?: string | null;
  email?: string | null;
  balance_override?: number | null;
  max_lots_override?: number | null;
  social_trading_url?: string | null;
  support_url?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type FundTxn = {
  id: string;
  user_id: string;
  kind: "deposit" | "withdraw";
  amount: number;
  method?: string | null;
  note?: string | null;
  status: string;
  created_at: string;
};

async function postJSON<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  login: (p: LoginPayload) => postJSON<LoginResponse>("/auth/login", p),
  account: (userId: string) => getJSON<AccountSummary>(`/account/${userId}`),
  placeOrder: (p: {
    user_id: string;
    symbol: string;
    side: "buy" | "sell";
    lots: number;
    price?: number;
    order_type?: "market" | "limit" | "stop" | "pending";
    target_price?: number | null;
    stop_loss?: number | null;
    expiry_minutes?: number | null;
  }) => postJSON<{ success: boolean; order: Order }>("/orders/place", p),
  positions: (userId: string) => getJSON<Order[]>(`/orders/positions/${userId}`),
  positionsForSymbol: (userId: string, symbol: string) =>
    getJSON<Order[]>(`/orders/by_symbol/${userId}/${encodeURIComponent(symbol)}`),
  history: (userId: string) => getJSON<Order[]>(`/orders/history/${userId}`),
  closeOrder: (p: { order_id: string; user_id: string; close_price?: number }) =>
    postJSON<{ success: boolean; order: Order }>("/orders/close", p),
  prices: () => getJSON<QuotesSnapshot>("/prices"),
  deposit: (p: { user_id: string; amount: number; method?: string; note?: string }) =>
    postJSON<{ success: boolean; transaction: FundTxn; account: AccountSummary }>(
      "/funds/deposit",
      p,
    ),
  withdraw: (p: { user_id: string; amount: number; method?: string; note?: string }) =>
    postJSON<{ success: boolean; transaction: FundTxn; account: AccountSummary }>(
      "/funds/withdraw",
      p,
    ),
  fundHistory: (userId: string) => getJSON<FundTxn[]>(`/funds/history/${userId}`),
  closeBatch: (p: {
    user_id: string;
    scope: "all" | "winners" | "losers" | "symbol";
    symbol?: string;
  }) => postJSON<{ success: boolean; closed_count: number }>("/orders/close_batch", p),
  publicSettings: () => getJSON<PublicSettings>("/settings/public"),

  // Admin
  adminLogin: (password: string) => postJSON<{ token: string }>("/admin/login", { password }),
  adminSettings: (token: string) =>
    fetch(`${API_BASE}/admin/settings`, { headers: { Authorization: `Bearer ${token}` } }).then(
      async (res) => {
        if (!res.ok) throw new Error((await res.json())?.detail || "Admin error");
        return res.json() as Promise<Record<string, any>>;
      },
    ),
  adminUpdateSettings: (token: string, body: Record<string, any>) =>
    fetch(`${API_BASE}/admin/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json())?.detail || "Admin error");
      return res.json() as Promise<Record<string, any>>;
    }),
  adminListUsers: (token: string) =>
    fetch(`${API_BASE}/admin/users`, { headers: { Authorization: `Bearer ${token}` } }).then(
      async (res) => {
        if (!res.ok) throw new Error((await res.json())?.detail || "Admin error");
        return res.json() as Promise<AdminUser[]>;
      },
    ),
  adminUpsertUser: (token: string, body: AdminUser) =>
    fetch(`${API_BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json())?.detail || "Admin error");
      return res.json() as Promise<AdminUser>;
    }),
  adminDeleteUser: (token: string, userId: string) =>
    fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json())?.detail || "Admin error");
      return res.json();
    }),
};

// WebSocket URL — swap http(s):// -> ws(s)://
export function pricesWsUrl(): string {
  const base = API_BASE.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
  return `${base}/ws/prices`;
}
