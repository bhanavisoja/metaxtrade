import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { HotMovers } from "@/src/components/hot-movers";
import { Icon } from "@/src/components/icon";
import { OrderTicket } from "@/src/components/order-ticket";
import { useBrokerSettings } from "@/src/prefs/broker-settings";
import { usePrices } from "@/src/prices/price-store";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Category = "All" | "Forex" | "Crypto" | "Metals";

const CATEGORIES: Category[] = ["All", "Forex", "Crypto", "Metals"];

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
  balancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.pill,
  },
  balanceText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700" },
  chipsRow: {
    height: 44,
  },
  chipsContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.onSurface,
    borderColor: colors.onSurface,
  },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.surface },
  listHeader: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  colSymbol: { flex: 2, color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  colQuote: { flex: 1.3, color: colors.muted, fontSize: 11, fontWeight: "700", textAlign: "right" },
  colChange: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "700", textAlign: "right" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowSymbolCell: { flex: 2 },
  rowSymbol: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  rowCategory: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowQuote: { flex: 1.3, alignItems: "flex-end" },
  rowBid: { color: colors.error, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rowAsk: { color: colors.success, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rowBidSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowChange: {
    flex: 1,
    alignItems: "flex-end",
  },
  changeUp: { color: colors.success, fontSize: 13, fontWeight: "700" },
  changeDown: { color: colors.error, fontSize: 13, fontWeight: "700" },
  changeNeutral: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  empty: {
    padding: spacing.xxl,
    alignItems: "center",
  },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
}));

function categoryOf(symbol: string): Category {
  if (symbol.startsWith("XAU") || symbol.startsWith("XAG")) return "Metals";
  if (
    symbol.startsWith("BTC") ||
    symbol.startsWith("ETH") ||
    symbol.startsWith("SOL") ||
    symbol.startsWith("XRP") ||
    symbol.startsWith("BNB")
  ) {
    return "Crypto";
  }
  return "Forex";
}

export default function WatchlistScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const branding = useBrokerSettings();
  const { quotes } = usePrices();

  const [category, setCategory] = useState<Category>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = Object.values(quotes).sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (category === "All") return list;
    return list.filter((q) => categoryOf(q.symbol) === category);
  }, [quotes, category]);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="watchlist-screen">
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.title}>Watchlist</Text>
          <Pressable
            style={styles.balancePill}
            onPress={() => branding.allow_funds && router.push("/funds")}
            testID="watchlist-balance-pill"
          >
            <Icon name="wallet-outline" size={14} color={colors.brandPrimary} />
            <Text style={styles.balanceText}>${user?.balance?.toFixed(2) ?? "0.00"}</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map((cat) => {
            const active = cat === category;
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[styles.chip, active && styles.chipActive]}
                testID={`watchlist-chip-${cat.toLowerCase()}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <HotMovers onPress={(symbol) => setTicketSymbol(symbol)} />

      <View style={styles.listHeader}>
        <Text style={styles.colSymbol}>SYMBOL</Text>
        <Text style={styles.colQuote}>BID / ASK</Text>
        <Text style={styles.colChange}>CHG %</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.symbol}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Connecting to live price feed… this should take just a moment.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const change = item.change_pct;
          const changeStyle =
            change > 0 ? styles.changeUp : change < 0 ? styles.changeDown : styles.changeNeutral;
          const prefix = change > 0 ? "+" : "";
          return (
            <Pressable
              style={styles.row}
              onPress={() => setTicketSymbol(item.symbol)}
              testID={`watchlist-row-${item.symbol}`}
            >
              <View style={styles.rowSymbolCell}>
                <Text style={styles.rowSymbol}>{item.symbol}</Text>
                <Text style={styles.rowCategory}>{categoryOf(item.symbol)}</Text>
              </View>
              <View style={styles.rowQuote}>
                <Text style={styles.rowAsk}>{item.ask.toFixed(5)}</Text>
                <Text style={styles.rowBidSmall}>{item.bid.toFixed(5)}</Text>
              </View>
              <View style={styles.rowChange}>
                <Text style={changeStyle}>
                  {prefix}
                  {change.toFixed(3)}%
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <OrderTicket
        symbol={ticketSymbol}
        visible={!!ticketSymbol}
        onClose={() => setTicketSymbol(null)}
      />
    </View>
  );
}
