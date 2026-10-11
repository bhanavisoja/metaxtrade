// HotMovers - top-of-screen horizontal strip of the top-5 % movers (biggest
// absolute change). Tapping a card calls onPress with the symbol so the
// parent can open the OrderTicket.

import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { usePrices } from "@/src/prices/price-store";
import { makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  wrap: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  card: {
    width: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  symbol: { color: colors.onSurface, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  priceRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  price: { color: colors.onSurface, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  changeUp: { color: colors.success, fontSize: 12, fontWeight: "800" },
  changeDown: { color: colors.error, fontSize: 12, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 11, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
}));

export function HotMovers({ onPress }: { onPress: (symbol: string) => void }) {
  const styles = useStyles();
  const { quotes } = usePrices();

  const top = useMemo(() => {
    const list = Object.values(quotes).filter((q) => Math.abs(q.change_pct) > 0);
    list.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
    return list.slice(0, 5);
  }, [quotes]);

  return (
    <View style={styles.wrap} testID="hot-movers-strip">
      <Text style={styles.label}>HOT MOVERS</Text>
      {top.length === 0 ? (
        <Text style={styles.emptyText}>Waiting for the first price tick…</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {top.map((q) => {
            const up = q.change_pct >= 0;
            return (
              <Pressable
                key={q.symbol}
                style={styles.card}
                onPress={() => onPress(q.symbol)}
                testID={`hot-mover-${q.symbol}`}
              >
                <Text style={styles.symbol}>{q.symbol}</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{q.mid.toFixed(q.mid > 100 ? 2 : 5)}</Text>
                  <Text style={up ? styles.changeUp : styles.changeDown}>
                    {up ? "+" : ""}
                    {q.change_pct.toFixed(2)}%
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
