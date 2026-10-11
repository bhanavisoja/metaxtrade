import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { Icon, type IconName } from "@/src/components/icon";
import { useBrokerSettings } from "@/src/prefs/broker-settings";
import { useTradingMode } from "@/src/prefs/trading-mode";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
  profileCard: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.onSurface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: "800" },
  profileText: { flex: 1 },
  profileName: { color: colors.surface, fontSize: 17, fontWeight: "700" },
  profileEmail: { color: colors.muted, fontSize: 13, marginTop: 2 },
  profileId: { color: colors.surface, fontSize: 12, marginTop: 6, opacity: 0.6 },

  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  statCell: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  statLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
  statValue: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  sectionTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: { flex: 1 },
  itemTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  itemSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  itemValue: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },

  logoutBtn: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    alignItems: "center",
  },
  logoutText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  footer: { color: colors.muted, fontSize: 11, textAlign: "center", padding: spacing.lg },
}));

function Row({
  icon,
  title,
  subtitle,
  value,
  iconColor,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  iconColor?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const inner = (
    <>
      <View style={styles.itemIcon}>
        <Icon name={icon} size={20} color={iconColor ?? colors.onSurfaceSecondary} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle}>{title}</Text>
        {subtitle ? <Text style={styles.itemSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.itemValue}>{value}</Text> : null}
      {onPress ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable style={styles.item} onPress={onPress} testID={testID}>
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={styles.item} testID={testID}>
      {inner}
    </View>
  );
}

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, refreshAccount } = useAuth();
  const [tradingMode, setTradingMode] = useTradingMode();
  const branding = useBrokerSettings();

  // Pull fresh account_type, name and links on mount so cached sessions
  // reflect any admin-side updates.
  useEffect(() => {
    refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initial = (user?.name?.[0] ?? user?.user_id?.[0] ?? "U").toUpperCase();

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="settings-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} testID="settings-profile-name">
              {user?.name && user.name.trim() ? user.name : user?.user_id ?? "—"}
            </Text>
            <Text style={styles.profileId}>ID: {user?.user_id ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>BALANCE</Text>
            <Text style={styles.statValue}>${user?.balance?.toFixed(2) ?? "0.00"}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>MAX LOTS</Text>
            <Text style={styles.statValue}>{user?.max_lots?.toFixed(2) ?? "0.01"}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>FUNDS</Text>
        {branding.allow_funds ? (
          <>
            <Row
              icon="arrow-down-bold-circle-outline"
              title="Deposit funds"
              subtitle="Add balance via card, crypto or wire"
              onPress={() => router.push("/funds?mode=deposit")}
              iconColor={colors.success}
              testID="settings-deposit"
            />
            <Row
              icon="arrow-up-bold-circle-outline"
              title="Withdraw funds"
              subtitle="Request a payout to your preferred method"
              onPress={() => router.push("/funds?mode=withdraw")}
              iconColor={colors.brandPrimary}
              testID="settings-withdraw"
            />
          </>
        ) : (
          <Row
            icon="information-outline"
            title="Funds management disabled"
            subtitle="Contact your broker to deposit or withdraw funds"
            testID="settings-funds-disabled"
          />
        )}

        <Text style={styles.sectionTitle}>TRADING</Text>
        <Row
          icon={tradingMode === "onetap" ? "flash" : "shield-check"}
          title="Trading mode"
          subtitle={
            tradingMode === "onetap"
              ? "One-Tap · tap SELL/BUY and the order fires instantly"
              : "Standard · set Take Profit and Stop Loss before confirming"
          }
          value={tradingMode === "onetap" ? "One-Tap" : "Standard"}
          onPress={() => setTradingMode(tradingMode === "onetap" ? "standard" : "onetap")}
          iconColor={colors.brandPrimary}
          testID="settings-trading-mode"
        />
        <Row
          icon="account-group-outline"
          title="Social Trading"
          subtitle="Copy top traders · opens in your browser"
          onPress={() => {
            const url = user?.social_trading_url;
            if (url) Linking.openURL(url);
          }}
          iconColor={colors.brandPrimary}
          testID="settings-social-trading"
        />
        <Row
          icon="lifebuoy"
          title="Customer Support"
          subtitle="Chat with our support team · opens in your browser"
          onPress={() => {
            const url = user?.support_url;
            if (url) Linking.openURL(url);
          }}
          iconColor={colors.info}
          testID="settings-customer-support"
        />
        <Row
          icon="scale-balance"
          title="Leverage policy"
          subtitle="Max lots = balance ÷ $1,000 (min 0.01)"
        />
        <Row
          icon="chart-bar"
          title="Account type"
          value={user?.account_type ?? "Live"}
        />

        <Pressable style={styles.logoutBtn} onPress={doLogout} testID="settings-logout-button">
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Pressable
          style={{ padding: spacing.md, alignItems: "center" }}
          onPress={() => router.push("/admin")}
          testID="settings-admin-link"
        >
          <Text style={{ color: colors.muted, fontSize: 11 }}>Broker admin panel →</Text>
        </Pressable>

        <Text style={styles.footer}>{branding.broker_name} · v1.1.0</Text>
      </ScrollView>
    </View>
  );
}
