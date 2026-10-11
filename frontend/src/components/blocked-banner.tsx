// Thin banner that appears at the top of every tab screen when the user's
// account has been liquidated (equity ≤ 0). Prompts them to deposit funds.

import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { useBrokerSettings } from "@/src/prefs/broker-settings";
import { makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  banner: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  text: { flex: 1, color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  cta: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
  },
  ctaText: { color: colors.error, fontSize: 11, fontWeight: "800" },
}));

export function BlockedBanner() {
  const styles = useStyles();
  const router = useRouter();
  const { user, refreshAccount } = useAuth();
  const branding = useBrokerSettings();

  // Immediate refresh on mount — otherwise the banner takes up to 5s to appear
  // right after a login where equity is already ≤ 0.
  useEffect(() => {
    refreshAccount();
    const t = setInterval(() => refreshAccount(), 5000);
    return () => clearInterval(t);
  }, [refreshAccount]);

  if (!user?.blocked) return null;

  return (
    <View style={styles.banner} testID="blocked-banner">
      <Icon name="alert-octagon" size={16} color="#FFFFFF" />
      <Text style={styles.text}>
        Account liquidated. New trades are blocked until you deposit funds.
      </Text>
      {branding.allow_funds ? (
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/funds?mode=deposit")}
          testID="blocked-banner-deposit"
        >
          <Text style={styles.ctaText}>DEPOSIT</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
