// Fetches and caches the public broker settings (branding + feature flags).
// Refreshes on focus of a screen that uses it.

import { useEffect, useState } from "react";

import { api, type PublicSettings } from "@/src/api/client";

const DEFAULTS: PublicSettings = {
  broker_name: "MetaXtrade",
  broker_tagline: "Professional Trading Terminal",
  broker_logo_url: null,
  allow_funds: true,
  commission_per_lot: 20.0,
  deposit_instructions: "",
  withdrawal_instructions: "",
};

let cache: PublicSettings = DEFAULTS;
const listeners = new Set<(s: PublicSettings) => void>();
let fetchedOnce = false;

export async function refreshBrokerSettings(): Promise<PublicSettings> {
  try {
    const data = await api.publicSettings();
    cache = { ...DEFAULTS, ...data };
  } catch {
    cache = { ...DEFAULTS };
  }
  listeners.forEach((cb) => cb(cache));
  return cache;
}

export function useBrokerSettings(): PublicSettings {
  const [state, setState] = useState<PublicSettings>(cache);
  useEffect(() => {
    const cb = (s: PublicSettings) => setState(s);
    listeners.add(cb);
    if (!fetchedOnce) {
      fetchedOnce = true;
      refreshBrokerSettings();
    } else {
      // Soft refresh on every mount so admin changes propagate quickly.
      refreshBrokerSettings();
    }
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return state;
}
