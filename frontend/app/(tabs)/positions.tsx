import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Order } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { OrderTicket } from "@/src/components/order-ticket";
import { usePrices } from "@/src/prices/price-store";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
  summaryRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  summaryCell: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  summaryLabel: { color: colors.muted, fontSize: 11, marginBottom: 2 },
  summaryValue: { color: colors.onSurface, fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  summaryPnlUp: { color: colors.success },
  summaryPnlDown: { color: colors.error },

  bulkRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  bulkBtnAll: { borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  bulkBtnWinners: { borderColor: colors.success, backgroundColor: colors.surface },
  bulkBtnLosers: { borderColor: colors.error, backgroundColor: colors.surface },
  bulkBtnText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  bulkBtnTextAll: { color: colors.onSurface },
  bulkBtnTextWinners: { color: colors.success },
  bulkBtnTextLosers: { color: colors.error },

  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  rowSymbolRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowSymbol: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  sidePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  sideBuy: { backgroundColor: colors.success },
  sideSell: { backgroundColor: colors.error },
  sidePillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  rowPnl: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pnlUp: { color: colors.success },
  pnlDown: { color: colors.error },

  rowMid: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  rowKV: { flex: 1 },
  rowK: { color: colors.muted, fontSize: 11 },
  rowV: { color: colors.onSurface, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },

  rowActions: { flexDirection: "row", gap: spacing.sm },
  rowBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
    borderWidth: 1,
  },
  closeBtn: { backgroundColor: colors.surface, borderColor: colors.error },
  closeBtnText: { color: colors.error, fontSize: 13, fontWeight: "700" },
  tradeMoreBtn: { backgroundColor: colors.surface, borderColor: colors.border },
  tradeMoreBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },

  empty: { padding: spacing.xxl, alignItems: "center" },
  emptyIcon: { marginBottom: spacing.md },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  emptyText: { color: colors.muted, textAlign: "center" },
}));

export default function PositionsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount } = useAuth();
  const { quotes } = usePrices();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [ticketSymbol, setTicketSymbol] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.positions(user.user_id);
      setOrders(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
      timerRef.current = setInterval(load, 3000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Overlay live quotes on orders (positions server returns pnl, but we also
  // sync current_price in real time for a snappier UI).
  const enriched = orders.map((o) => {
    const q = quotes[o.symbol];
    const live = q ? (o.side === "buy" ? q.bid : q.ask) : o.current_price ?? o.entry_price;
    return { ...o, current_price: live };
  });

  const totalPnl = enriched.reduce((s, o) => s + (o.pnl ?? 0), 0);

  const closeOrder = async (order: Order) => {
    if (!user) return;
    setClosingId(order.id);
    try {
      await api.closeOrder({ order_id: order.id, user_id: user.user_id });
      await load();
      await refreshAccount();
    } catch {
      // ignore
    } finally {
      setClosingId(null);
    }
  };

  const closeBatch = async (scope: "all" | "winners" | "losers") => {
    if (!user) return;
    try {
      await api.closeBatch({ user_id: user.user_id, scope });
      await load();
      await refreshAccount();
    } catch {
      // ignore
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="positions-screen">
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.title}>Positions</Text>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>OPEN</Text>
            <Text style={styles.summaryValue}>{enriched.length}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>FLOATING P&L</Text>
            <Text
              style={[
                styles.summaryValue,
                totalPnl > 0 ? styles.summaryPnlUp : totalPnl < 0 ? styles.summaryPnlDown : null,
              ]}
              testID="positions-total-pnl"
            >
              {totalPnl >= 0 ? "+" : ""}
              {totalPnl.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>BALANCE</Text>
            <Text style={styles.summaryValue}>${user?.balance?.toFixed(2) ?? "0.00"}</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <>
          {enriched.filter((o) => o.status === "open").length > 1 ? (
            <View style={styles.bulkRow} testID="positions-bulk-row">
              <Pressable
                style={[styles.bulkBtn, styles.bulkBtnAll]}
                onPress={() => closeBatch("all")}
                testID="positions-close-all"
              >
                <Text style={[styles.bulkBtnText, styles.bulkBtnTextAll]}>CLOSE ALL</Text>
              </Pressable>
              <Pressable
                style={[styles.bulkBtn, styles.bulkBtnWinners]}
                onPress={() => closeBatch("winners")}
                testID="positions-close-winners"
              >
                <Text style={[styles.bulkBtnText, styles.bulkBtnTextWinners]}>CLOSE WINNERS</Text>
              </Pressable>
              <Pressable
                style={[styles.bulkBtn, styles.bulkBtnLosers]}
                onPress={() => closeBatch("losers")}
                testID="positions-close-losers"
              >
                <Text style={[styles.bulkBtnText, styles.bulkBtnTextLosers]}>CLOSE LOSERS</Text>
              </Pressable>
            </View>
          ) : null}
          <FlatList
          data={enriched}
          keyExtractor={(o) => o.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name="briefcase-outline" size={48} color={colors.muted} />
              </View>
              <Text style={styles.emptyTitle}>No open positions</Text>
              <Text style={styles.emptyText}>
                Open a trade from the Chart or Watchlist to see it here with live P&L.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const pnl = item.pnl ?? 0;
            const pnlStyle = pnl > 0 ? styles.pnlUp : pnl < 0 ? styles.pnlDown : null;
            const isBuy = item.side === "buy";
            const isPending = item.status === "pending";
            const sideLabel = isPending
              ? `${(item.order_type ?? "limit").toUpperCase()} ${isBuy ? "BUY" : "SELL"}`
              : isBuy ? "BUY" : "SELL";
            return (
              <View style={styles.row} testID={`position-row-${item.id}`}>
                <View style={styles.rowTop}>
                  <View style={styles.rowSymbolRow}>
                    <Text style={styles.rowSymbol}>{item.symbol}</Text>
                    <View style={[styles.sidePill, isBuy ? styles.sideBuy : styles.sideSell]}>
                      <Text style={styles.sidePillText}>{sideLabel}</Text>
                    </View>
                    <Text style={styles.rowK}>{item.lots.toFixed(2)} lot</Text>
                  </View>
                  <Text style={[styles.rowPnl, pnlStyle]}>
                    {isPending ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                  </Text>
                </View>

                <View style={styles.rowMid}>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>{isPending ? "Trigger" : "Entry"}</Text>
                    <Text style={styles.rowV}>
                      {(item.trigger_price ?? item.entry_price).toFixed(5)}
                    </Text>
                  </View>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>Current</Text>
                    <Text style={styles.rowV}>
                      {(item.current_price ?? item.entry_price).toFixed(5)}
                    </Text>
                  </View>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>Comm.</Text>
                    <Text style={styles.rowV}>${item.commission.toFixed(2)}</Text>
                  </View>
                </View>

                {item.target_price || item.stop_loss ? (
                  <View style={styles.rowMid}>
                    <View style={styles.rowKV}>
                      <Text style={styles.rowK}>Take Profit</Text>
                      <Text style={styles.rowV}>
                        {item.target_price ? item.target_price.toFixed(5) : "—"}
                      </Text>
                    </View>
                    <View style={styles.rowKV}>
                      <Text style={styles.rowK}>Stop Loss</Text>
                      <Text style={styles.rowV}>
                        {item.stop_loss ? item.stop_loss.toFixed(5) : "—"}
                      </Text>
                    </View>
                    <View style={styles.rowKV} />
                  </View>
                ) : null}

                <View style={styles.rowActions}>
                  <Pressable
                    style={[styles.rowBtn, styles.tradeMoreBtn]}
                    onPress={() => setTicketSymbol(item.symbol)}
                    testID={`position-trade-more-${item.id}`}
                  >
                    <Text style={styles.tradeMoreBtnText}>Trade more</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.rowBtn, styles.closeBtn, closingId === item.id && { opacity: 0.6 }]}
                    disabled={closingId === item.id}
                    onPress={() => closeOrder(item)}
                    testID={`position-close-${item.id}`}
                  >
                    {closingId === item.id ? (
                      <ActivityIndicator color={colors.error} />
                    ) : (
                      <Text style={styles.closeBtnText}>
                        {isPending ? "Cancel order" : "Close position"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
        </>
      )}

      <OrderTicket
        symbol={ticketSymbol}
        visible={!!ticketSymbol}
        onClose={() => {
          setTicketSymbol(null);
          load();
        }}
      />
    </View>
  );
}
