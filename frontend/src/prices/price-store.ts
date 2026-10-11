// Shared live-price store backed by the backend WebSocket at /api/ws/prices.
// Single global connection, components subscribe via usePrices().

import { useEffect, useState } from "react";

import { pricesWsUrl, type Quote } from "@/src/api/client";

type Snapshot = Record<string, Quote>;
type Categories = { forex: string[]; crypto: string[]; metals: string[] };

let snapshot: Snapshot = {};
let categories: Categories = { forex: [], crypto: [], metals: [] };
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((cb) => cb());
}

function connect() {
  if (typeof WebSocket === "undefined") return;
  try {
    const url = pricesWsUrl();
    ws = new WebSocket(url);
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed?.type === "snapshot") {
          snapshot = parsed.data ?? {};
          if (parsed.categories) categories = parsed.categories;
          notify();
        } else if (parsed?.type === "prices") {
          snapshot = { ...snapshot, ...(parsed.data ?? {}) };
          notify();
        }
      } catch {
        /* ignore malformed message */
      }
    };
    ws.onclose = () => {
      ws = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 2000);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  } catch {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }
}

export function ensurePricesConnected() {
  if (!ws) connect();
}

export function getQuote(symbol: string): Quote | undefined {
  return snapshot[symbol.toUpperCase()];
}

export function usePrices(): { quotes: Snapshot; categories: Categories } {
  const [, setTick] = useState(0);
  useEffect(() => {
    ensurePricesConnected();
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return { quotes: snapshot, categories };
}
