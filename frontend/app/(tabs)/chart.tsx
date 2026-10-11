import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { api, type Order } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { OrderTicket } from "@/src/components/order-ticket";
import { usePrices } from "@/src/prices/price-store";
import { useTradingMode } from "@/src/prefs/trading-mode";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const SYMBOLS: { label: string; apex: string; tv: string }[] = [
  { label: "EUR/USD", apex: "EUR/USD", tv: "FX:EURUSD" },
  { label: "GBP/USD", apex: "GBP/USD", tv: "FX:GBPUSD" },
  { label: "USD/JPY", apex: "USD/JPY", tv: "FX:USDJPY" },
  { label: "AUD/USD", apex: "AUD/USD", tv: "FX:AUDUSD" },
  { label: "USD/CAD", apex: "USD/CAD", tv: "FX:USDCAD" },
  { label: "XAU/USD", apex: "XAU/USD", tv: "OANDA:XAUUSD" },
  { label: "XAG/USD", apex: "XAG/USD", tv: "OANDA:XAGUSD" },
  { label: "BTC/USD", apex: "BTC/USD", tv: "BINANCE:BTCUSDT" },
  { label: "ETH/USD", apex: "ETH/USD", tv: "BINANCE:ETHUSDT" },
  { label: "SOL/USD", apex: "SOL/USD", tv: "BINANCE:SOLUSDT" },
  { label: "XRP/USD", apex: "XRP/USD", tv: "BINANCE:XRPUSDT" },
  { label: "BNB/USD", apex: "BNB/USD", tv: "BINANCE:BNBUSDT" },
];

const INITIAL_INTERVAL = "5"; // 5m default per spec; user can change inside TradingView's toolbar.

function buildTradingViewHtml(tvSymbol: string, interval: string): string {
  // Full-bleed TradingView advanced widget — no margins, matches webtrader look.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #ffffff; overflow: hidden; }
    #tv_chart_container { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="tv_chart_container"></div>
  <script src="https://s3.tradingview.com/tv.js"></script>
  <script>
    try {
      new TradingView.widget({
        autosize: true,
        symbol: "${tvSymbol}",
        interval: "${interval}",
        timezone: "Etc/UTC",
        theme: "light",
        style: "1",
        locale: "en",
        toolbar_bg: "#ffffff",
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        container_id: "tv_chart_container",
        studies: ["Volume@tv-basicstudies"]
      });
    } catch (e) {
      document.body.innerText = "Chart failed to load: " + e.message;
    }
  </script>
</body>
</html>`;
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  symbolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
  },
  symbolBtnText: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  priceInline: {
    marginLeft: spacing.xs,
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  changeUp: { color: colors.success, fontSize: 12, fontWeight: "700" },
  changeDown: { color: colors.error, fontSize: 12, fontWeight: "700" },
  flexSpacer: { flex: 1 },
  modeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  modeToggleText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },

  intervalRow: {
    height: 36,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  intervalContent: {
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    alignItems: "center",
  },
  intervalChip: {
    flexShrink: 0,
    height: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  intervalChipActive: { backgroundColor: colors.onSurface },
  intervalChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  intervalChipTextActive: { color: colors.surface },

  symbolDropdown: {
    position: "absolute",
    top: 48,
    left: spacing.md,
    width: 180,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    zIndex: 10,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  symbolOption: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  symbolOptionText: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  symbolOptionActive: { backgroundColor: colors.brandTertiary },

  chartBox: { flex: 1, backgroundColor: colors.surface },
  webviewFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  webviewFallbackText: { color: colors.muted, textAlign: "center" },

  tradeBar: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tradeBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sellBtn: { backgroundColor: colors.error },
  buyBtn: { backgroundColor: colors.success },
  tradeBtnLabel: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  tradeBtnPrice: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  lotSelector: {
    width: 110,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  lotLabel: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingTop: 4,
  },
  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  lotStep: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  lotValue: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  posPanel: {
    maxHeight: 170,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  posHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceTertiary,
  },
  posHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  posTitle: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  posCount: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
  posTotalUp: { color: colors.success, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  posTotalDown: { color: colors.error, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },

  posRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  sidePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 42,
    alignItems: "center",
  },
  sideBuy: { backgroundColor: colors.success },
  sideSell: { backgroundColor: colors.error },
  sidePillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  posSymbol: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  posLots: { color: colors.muted, fontSize: 11, marginTop: 1 },
  posPrices: { color: colors.onSurfaceSecondary, fontSize: 11, fontVariant: ["tabular-nums"] },
  posPnlUp: { color: colors.success, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  posPnlDown: { color: colors.error, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  closeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error,
  },
  closeBtnText: { color: colors.error, fontSize: 11, fontWeight: "800" },
  posEmpty: {
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  posEmptyText: { color: colors.muted, fontSize: 12 },
}));

export default function ChartScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount } = useAuth();
  const { quotes } = usePrices();
  const [mode, setMode] = useTradingMode();

  const [symbolIdx, setSymbolIdx] = useState(0);
  const [interval] = useState(INITIAL_INTERVAL);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketSide, setTicketSide] = useState<"buy" | "sell">("buy");
  const [lots, setLots] = useState(0.01);
  const [positions, setPositions] = useState<Order[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = SYMBOLS[symbolIdx];
  const quote = quotes[current.apex];
  const maxLots = user?.max_lots ?? 0.01;

  // Keep lots within the account cap when the user switches account / updates balance.
  useEffect(() => {
    if (lots > maxLots) setLots(maxLots);
  }, [maxLots, lots]);

  const html = useMemo(() => buildTradingViewHtml(current.tv, interval), [current, interval]);

  const loadPositions = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.positions(user.user_id);
      setPositions(data);
    } catch {
      // ignore
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadPositions();
      timerRef.current = setInterval(loadPositions, 3000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [loadPositions]),
  );

  const openOrdersEnriched = useMemo(() => {
    return positions.map((p) => {
      const q = quotes[p.symbol];
      const live = q ? (p.side === "buy" ? q.bid : q.ask) : p.current_price ?? p.entry_price;
      return { ...p, current_price: live };
    });
  }, [positions, quotes]);

  const totalPnl = openOrdersEnriched.reduce((s, p) => s + (p.pnl ?? 0), 0);

  const closePosition = async (order: Order) => {
    if (!user) return;
    setClosingId(order.id);
    try {
      await api.closeOrder({ order_id: order.id, user_id: user.user_id });
      await loadPositions();
      await refreshAccount();
    } catch {
      // ignore
    } finally {
      setClosingId(null);
    }
  };

  const adjustLot = (delta: number) => {
    const next = Math.max(0.01, Math.min(maxLots, +(lots + delta).toFixed(2)));
    setLots(next);
  };

  const onBuyOrSell = async (side: "buy" | "sell") => {
    setTicketSide(side);
    if (mode === "onetap") {
      // Fire a market order instantly, no modal.
      if (!quote || !user) return;
      try {
        await api.placeOrder({
          user_id: user.user_id,
          symbol: current.apex,
          side,
          lots,
          order_type: "market",
        });
        await refreshAccount();
        await loadPositions();
      } catch {
        // On error (e.g. max-lot) fall back to the ticket so the user sees the message.
        setTicketOpen(true);
      }
    } else {
      // Standard mode — open ticket to set TP/SL.
      setTicketOpen(true);
    }
  };

  const changeStyle = quote && quote.change_pct >= 0 ? styles.changeUp : styles.changeDown;
  const changeSign = quote && quote.change_pct > 0 ? "+" : "";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="chart-screen">
      <View style={styles.topBar}>
        <Pressable
          style={styles.symbolBtn}
          onPress={() => setSymbolMenuOpen((v) => !v)}
          testID="chart-symbol-selector"
        >
          <Text style={styles.symbolBtnText}>{current.label}</Text>
          <Icon
            name={symbolMenuOpen ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.onSurface}
          />
        </Pressable>
        <Text style={styles.priceInline}>{quote ? quote.mid.toFixed(5) : "—"}</Text>
        {quote ? (
          <Text style={changeStyle}>
            {changeSign}
            {quote.change_pct.toFixed(2)}%
          </Text>
        ) : null}
        <View style={styles.flexSpacer} />
        <Pressable
          style={styles.modeToggle}
          onPress={() => setMode(mode === "onetap" ? "standard" : "onetap")}
          testID="chart-mode-toggle"
        >
          <Icon
            name={mode === "onetap" ? "flash" : "shield-check"}
            size={12}
            color={colors.brandPrimary}
          />
          <Text style={styles.modeToggleText}>
            {mode === "onetap" ? "ONE-TAP" : "STANDARD"}
          </Text>
        </Pressable>
      </View>

      <View style={{ position: "relative" }}>
        {symbolMenuOpen ? (
          <View style={styles.symbolDropdown}>
            <ScrollView>
              {SYMBOLS.map((s, i) => (
                <Pressable
                  key={s.apex}
                  style={[styles.symbolOption, i === symbolIdx && styles.symbolOptionActive]}
                  onPress={() => {
                    setSymbolIdx(i);
                    setSymbolMenuOpen(false);
                  }}
                  testID={`chart-symbol-option-${s.apex}`}
                >
                  <Text style={styles.symbolOptionText}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View style={styles.chartBox}>
        {Platform.OS === "web" ? (
          <iframe
            key={`${current.tv}-${interval}`}
            srcDoc={html}
            style={{ border: "0", width: "100%", height: "100%" }}
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        ) : (
          <WebView
            key={`${current.tv}-${interval}`}
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://s3.tradingview.com" }}
            javaScriptEnabled
            domStorageEnabled
            scalesPageToFit
            allowsInlineMediaPlayback
            style={{ flex: 1, backgroundColor: colors.surface }}
            renderError={() => (
              <View style={styles.webviewFallback}>
                <Text style={styles.webviewFallbackText}>
                  TradingView widget failed to load. Check your network connection.
                </Text>
              </View>
            )}
          />
        )}
      </View>

      <View style={styles.tradeBar}>
        <Pressable
          style={[styles.tradeBtn, styles.sellBtn]}
          onPress={() => onBuyOrSell("sell")}
          testID="chart-sell-button"
        >
          <Text style={styles.tradeBtnLabel}>SELL</Text>
          <Text style={styles.tradeBtnPrice}>{quote ? quote.bid.toFixed(5) : "—"}</Text>
        </Pressable>

        <View style={styles.lotSelector} testID="chart-lot-selector">
          <Text style={styles.lotLabel}>LOTS</Text>
          <View style={styles.lotRow}>
            <Pressable style={styles.lotStep} onPress={() => adjustLot(-0.01)} testID="chart-lot-down">
              <Icon name="minus" size={16} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.lotValue}>{lots.toFixed(2)}</Text>
            <Pressable style={styles.lotStep} onPress={() => adjustLot(0.01)} testID="chart-lot-up">
              <Icon name="plus" size={16} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>

        <Pressable
          style={[styles.tradeBtn, styles.buyBtn]}
          onPress={() => onBuyOrSell("buy")}
          testID="chart-buy-button"
        >
          <Text style={styles.tradeBtnLabel}>BUY</Text>
          <Text style={styles.tradeBtnPrice}>{quote ? quote.ask.toFixed(5) : "—"}</Text>
        </Pressable>
      </View>

      <View style={[styles.posPanel, { paddingBottom: insets.bottom }]}>
        <View style={styles.posHeader}>
          <View style={styles.posHeaderLeft}>
            <Text style={styles.posTitle}>OPEN POSITIONS</Text>
            <Text style={styles.posCount}>{openOrdersEnriched.length}</Text>
          </View>
          <Text style={totalPnl >= 0 ? styles.posTotalUp : styles.posTotalDown}>
            {totalPnl >= 0 ? "+" : ""}
            {totalPnl.toFixed(2)}
          </Text>
        </View>
        {openOrdersEnriched.length === 0 ? (
          <View style={styles.posEmpty}>
            <Text style={styles.posEmptyText}>No open positions</Text>
          </View>
        ) : (
          <FlatList
            data={openOrdersEnriched}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => {
              const pnl = item.pnl ?? 0;
              const pnlStyle = pnl >= 0 ? styles.posPnlUp : styles.posPnlDown;
              const isBuy = item.side === "buy";
              const isPending = item.status === "pending";
              return (
                <View style={styles.posRow} testID={`chart-position-${item.id}`}>
                  <View style={[styles.sidePill, isBuy ? styles.sideBuy : styles.sideSell]}>
                    <Text style={styles.sidePillText}>
                      {isPending ? "PEND" : isBuy ? "BUY" : "SELL"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.posSymbol}>{item.symbol}</Text>
                    <Text style={styles.posLots}>
                      {item.lots.toFixed(2)} lot · {item.entry_price.toFixed(5)} →{" "}
                      {(item.current_price ?? item.entry_price).toFixed(5)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={pnlStyle}>
                      {isPending ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                    </Text>
                    <Pressable
                      style={styles.closeBtn}
                      onPress={() => closePosition(item)}
                      disabled={closingId === item.id}
                      testID={`chart-position-close-${item.id}`}
                    >
                      {closingId === item.id ? (
                        <ActivityIndicator color={colors.error} size="small" />
                      ) : (
                        <Text style={styles.closeBtnText}>CLOSE</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>

      <OrderTicket
        symbol={ticketOpen ? current.apex : null}
        visible={ticketOpen}
        onClose={() => {
          setTicketOpen(false);
          loadPositions();
        }}
        initialLots={lots}
        initialSide={ticketSide}
        initialType="market"
      />
    </View>
  );
}
