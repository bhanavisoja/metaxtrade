// Shared user preferences backed by local storage.
// Currently just the trading mode (One-Tap vs Standard).

import { useCallback, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";

export type TradingMode = "onetap" | "standard";

const KEY = "apexfx_trading_mode";
let cache: TradingMode = "onetap";
const listeners = new Set<(m: TradingMode) => void>();

let loaded = false;
async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const stored = await storage.getItem<TradingMode>(KEY, "onetap");
  if (stored === "standard" || stored === "onetap") {
    cache = stored;
    listeners.forEach((cb) => cb(cache));
  }
}

export function useTradingMode(): [TradingMode, (m: TradingMode) => Promise<void>] {
  const [mode, setMode] = useState<TradingMode>(cache);

  useEffect(() => {
    const cb = (m: TradingMode) => setMode(m);
    listeners.add(cb);
    ensureLoaded();
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const update = useCallback(async (m: TradingMode) => {
    cache = m;
    await storage.setItem(KEY, m);
    listeners.forEach((cb) => cb(m));
  }, []);

  return [mode, update];
}
