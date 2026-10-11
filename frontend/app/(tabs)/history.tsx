import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Order } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
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
  rowPnl: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pnlUp: { color: colors.success },
  pnlDown: { color: colors.error },
  rowMid: { flexDirection: "row", justifyContent: "space-between" },
  rowKV: { flex: 1 },
  rowK: { color: colors.muted, fontSize: 11 },
  rowV: { color: colors.onSurface, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  empty: { padding: spacing.xxl, alignItems: "center" },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 4, marginTop: spacing.md },
  emptyText: { color: colors.muted, textAlign: "center" },
}));

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function HistoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.history(user.user_id);
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
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="history-screen">
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="history" size={48} color={colors.muted} />
              <Text style={styles.emptyTitle}>No closed trades yet</Text>
              <Text style={styles.emptyText}>Closed positions and their P&L will appear here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const pnl = item.pnl ?? 0;
            const pnlStyle = pnl > 0 ? styles.pnlUp : pnl < 0 ? styles.pnlDown : null;
            const isBuy = item.side === "buy";
            return (
              <View style={styles.row} testID={`history-row-${item.id}`}>
                <View style={styles.rowTop}>
                  <View style={styles.rowSymbolRow}>
                    <Text style={styles.rowSymbol}>{item.symbol}</Text>
                    <View style={[styles.sidePill, isBuy ? styles.sideBuy : styles.sideSell]}>
                      <Text style={styles.sidePillText}>{isBuy ? "BUY" : "SELL"}</Text>
                    </View>
                    <Text style={styles.rowK}>{item.lots.toFixed(2)} lot</Text>
                  </View>
                  <Text style={[styles.rowPnl, pnlStyle]}>
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(2)}
                  </Text>
                </View>

                <View style={styles.rowMid}>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>Entry</Text>
                    <Text style={styles.rowV}>{item.entry_price.toFixed(5)}</Text>
                  </View>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>Close</Text>
                    <Text style={styles.rowV}>
                      {item.close_price != null ? item.close_price.toFixed(5) : "—"}
                    </Text>
                  </View>
                  <View style={styles.rowKV}>
                    <Text style={styles.rowK}>Closed</Text>
                    <Text style={styles.rowV}>{fmtDate(item.closed_at)}</Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
