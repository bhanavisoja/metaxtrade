// OrderTicket — supports two trading modes and four order types.
//
// Modes:
//   • One-Tap   → tap SELL / BUY and the market order fires instantly.
//   • Standard  → shows TP / SL inputs; execution still fires on tap.
//
// Order types (independent of mode):
//   • Market   → immediate fill
//   • Limit    → fills when price touches trigger (better than current)
//   • Stop     → fills when price touches trigger (worse than current)
//   • Pending  → scheduled; expires after `expiry_minutes`

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Quote } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { getQuote, usePrices } from "@/src/prices/price-store";
import { useTradingMode } from "@/src/prefs/trading-mode";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type OrderType = "market" | "limit" | "stop" | "pending";
const ORDER_TYPES: { key: OrderType; label: string }[] = [
  { key: "market", label: "Market" },
  { key: "limit", label: "Limit" },
  { key: "stop", label: "Stop" },
  { key: "pending", label: "Pending" },
];

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(14,17,22,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  body: { paddingHorizontal: spacing.xl },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  symbol: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  close: { padding: spacing.xs },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  modePillText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },

  quoteRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  quoteCell: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  quoteLabel: { color: colors.muted, fontSize: 11, marginBottom: 2 },
  bidValue: { color: colors.error, fontSize: 18, fontWeight: "700" },
  askValue: { color: colors.success, fontSize: 18, fontWeight: "700" },

  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  typeChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  typeChipTextActive: { color: colors.surface },

  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  lotRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  lotInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === "ios" ? spacing.md : spacing.sm,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    color: colors.onSurface,
  },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === "ios" ? spacing.md : spacing.sm,
    fontSize: 15,
    color: colors.onSurface,
  },
  twoCol: { flexDirection: "row", gap: spacing.md },
  twoColCell: { flex: 1 },
  meta: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },

  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  summaryKey: { color: colors.muted, fontSize: 13 },
  summaryVal: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },

  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  sellBtn: { backgroundColor: colors.error },
  buyBtn: { backgroundColor: colors.success },
  disabled: { opacity: 0.5 },
  actionBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },

  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  success: { color: colors.success, fontSize: 13, marginTop: spacing.sm },
}));

export function OrderTicket({
  symbol,
  visible,
  onClose,
  initialLots,
  initialSide,
  initialType,
}: {
  symbol: string | null;
  visible: boolean;
  onClose: () => void;
  initialLots?: number;
  initialSide?: "buy" | "sell";
  initialType?: OrderType;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount } = useAuth();
  const { quotes } = usePrices();
  const [mode] = useTradingMode();

  const [orderType, setOrderType] = useState<OrderType>(initialType ?? "market");
  const [lots, setLots] = useState("0.01");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const quote: Quote | undefined = symbol ? (quotes[symbol] ?? getQuote(symbol)) : undefined;
  const maxLots = user?.max_lots ?? 0.01;

  useEffect(() => {
    if (visible) {
      setError(null);
      setSuccess(null);
      setLots(initialLots ? String(initialLots) : maxLots >= 1 ? "1" : "0.01");
      setTriggerPrice(quote ? quote.mid.toFixed(5) : "");
      setTp("");
      setSl("");
      setExpiryMinutes("60");
      setOrderType(initialType ?? "market");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, maxLots, initialLots, initialType]);

  const lotsNum = useMemo(() => {
    const n = parseFloat(lots);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [lots]);

  const commission = useMemo(() => +(lotsNum * 20).toFixed(2), [lotsNum]);
  const needsTrigger = orderType !== "market";
  const needsTpSl = mode === "standard" || orderType !== "market";

  const canSubmit = !!quote && !!user && lotsNum > 0 && lotsNum <= maxLots && !submitting;

  const adjustLots = (delta: number) => {
    const next = Math.max(0.01, Math.min(maxLots, +(lotsNum + delta).toFixed(2)));
    setLots(String(next));
  };

  const place = async (side: "buy" | "sell") => {
    if (!canSubmit || !symbol || !user || !quote) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const basePrice = side === "buy" ? quote.ask : quote.bid;
      const triggerNum = parseFloat(triggerPrice);
      const tpNum = parseFloat(tp);
      const slNum = parseFloat(sl);
      const expiry = parseInt(expiryMinutes, 10);

      await api.placeOrder({
        user_id: user.user_id,
        symbol,
        side,
        lots: lotsNum,
        order_type: orderType,
        price: needsTrigger && Number.isFinite(triggerNum) ? triggerNum : basePrice,
        target_price: needsTpSl && Number.isFinite(tpNum) && tpNum > 0 ? tpNum : null,
        stop_loss: needsTpSl && Number.isFinite(slNum) && slNum > 0 ? slNum : null,
        expiry_minutes: orderType === "pending" && Number.isFinite(expiry) ? expiry : null,
      });

      const verb =
        orderType === "market"
          ? side === "buy" ? "BUY" : "SELL"
          : `${orderType.toUpperCase()} ${side.toUpperCase()}`;
      setSuccess(`${verb} ${lotsNum} lot ${symbol}`);
      await refreshAccount();
      setTimeout(() => onClose(), 900);
    } catch (e: any) {
      setError(e?.message || "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  // Default side when initialSide is provided — the parent decides when to auto-fire.
  // The ticket itself never auto-places, so opening it from Watchlist / Positions /
  // Standard-mode trade bar is always an explicit confirmation step.

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.body}>
              <View style={styles.headerRow}>
                <Text style={styles.symbol} testID="order-ticket-symbol">
                  {symbol ?? ""}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={styles.modePill}>
                    <Icon
                      name={mode === "onetap" ? "flash" : "shield-check"}
                      size={12}
                      color={colors.brandPrimary}
                    />
                    <Text style={styles.modePillText}>
                      {mode === "onetap" ? "ONE-TAP" : "STANDARD"}
                    </Text>
                  </View>
                  <Pressable style={styles.close} onPress={onClose} testID="order-ticket-close">
                    <Icon name="close" size={22} color={colors.onSurfaceSecondary} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.quoteRow}>
                <View style={styles.quoteCell}>
                  <Text style={styles.quoteLabel}>Bid (Sell)</Text>
                  <Text style={styles.bidValue} testID="order-ticket-bid">
                    {quote ? quote.bid.toFixed(5) : "—"}
                  </Text>
                </View>
                <View style={styles.quoteCell}>
                  <Text style={styles.quoteLabel}>Ask (Buy)</Text>
                  <Text style={styles.askValue} testID="order-ticket-ask">
                    {quote ? quote.ask.toFixed(5) : "—"}
                  </Text>
                </View>
              </View>

              <Text style={styles.label}>Order type</Text>
              <View style={styles.typeRow}>
                {ORDER_TYPES.map((t) => {
                  const active = orderType === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setOrderType(t.key)}
                      style={[styles.typeChip, active && styles.typeChipActive]}
                      testID={`order-type-${t.key}`}
                    >
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Lot size</Text>
              <View style={styles.lotRow}>
                <Pressable style={styles.stepBtn} onPress={() => adjustLots(-0.01)} testID="order-ticket-lots-down">
                  <Icon name="minus" size={20} color={colors.onSurface} />
                </Pressable>
                <TextInput
                  style={styles.lotInput}
                  value={lots}
                  onChangeText={setLots}
                  keyboardType="decimal-pad"
                  testID="order-ticket-lots-input"
                />
                <Pressable style={styles.stepBtn} onPress={() => adjustLots(0.01)} testID="order-ticket-lots-up">
                  <Icon name="plus" size={20} color={colors.onSurface} />
                </Pressable>
              </View>
              <Text style={styles.meta}>
                Max {maxLots.toFixed(2)} lots on ${user?.balance?.toFixed(2) ?? "0.00"} balance · $20/lot commission
              </Text>

              {needsTrigger ? (
                <>
                  <Text style={styles.label}>Trigger price</Text>
                  <TextInput
                    style={styles.input}
                    value={triggerPrice}
                    onChangeText={setTriggerPrice}
                    keyboardType="decimal-pad"
                    placeholder={quote ? quote.mid.toFixed(5) : ""}
                    placeholderTextColor={colors.muted}
                    testID="order-trigger-price"
                  />
                  {orderType === "pending" ? (
                    <>
                      <Text style={styles.label}>Expires in (minutes)</Text>
                      <TextInput
                        style={styles.input}
                        value={expiryMinutes}
                        onChangeText={setExpiryMinutes}
                        keyboardType="number-pad"
                        placeholder="60"
                        placeholderTextColor={colors.muted}
                        testID="order-expiry-minutes"
                      />
                    </>
                  ) : null}
                </>
              ) : null}

              {needsTpSl ? (
                <View style={styles.twoCol}>
                  <View style={styles.twoColCell}>
                    <Text style={styles.label}>Take Profit</Text>
                    <TextInput
                      style={styles.input}
                      value={tp}
                      onChangeText={setTp}
                      keyboardType="decimal-pad"
                      placeholder="Optional"
                      placeholderTextColor={colors.muted}
                      testID="order-take-profit"
                    />
                  </View>
                  <View style={styles.twoColCell}>
                    <Text style={styles.label}>Stop Loss</Text>
                    <TextInput
                      style={styles.input}
                      value={sl}
                      onChangeText={setSl}
                      keyboardType="decimal-pad"
                      placeholder="Optional"
                      placeholderTextColor={colors.muted}
                      testID="order-stop-loss"
                    />
                  </View>
                </View>
              ) : null}

              <View style={styles.summaryRow}>
                <Text style={styles.summaryKey}>Commission</Text>
                <Text style={styles.summaryVal} testID="order-ticket-commission">
                  ${commission.toFixed(2)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryKey}>Account balance</Text>
                <Text style={styles.summaryVal}>${user?.balance?.toFixed(2) ?? "0.00"}</Text>
              </View>

              {error ? (
                <Text style={styles.error} testID="order-ticket-error">
                  {error}
                </Text>
              ) : null}
              {success ? (
                <Text style={styles.success} testID="order-ticket-success">
                  {success}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <Pressable
                  style={[styles.actionBtn, styles.sellBtn, !canSubmit && styles.disabled]}
                  onPress={() => place("sell")}
                  disabled={!canSubmit}
                  testID="order-ticket-sell-button"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.actionBtnText}>
                      SELL {quote ? quote.bid.toFixed(5) : ""}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.buyBtn, !canSubmit && styles.disabled]}
                  onPress={() => place("buy")}
                  disabled={!canSubmit}
                  testID="order-ticket-buy-button"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.actionBtnText}>
                      BUY {quote ? quote.ask.toFixed(5) : ""}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
