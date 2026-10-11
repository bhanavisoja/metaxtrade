import { Redirect, Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { BlockedBanner } from "@/src/components/blocked-banner";
import { Icon, type IconName } from "@/src/components/icon";
import { ensurePricesConnected } from "@/src/prices/price-store";
import { useTheme } from "@/src/theme";

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <Icon name={name} size={24} color={color} />;
}

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    ensurePricesConnected();
  }, []);

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1 }}>
      <BlockedBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brandPrimary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            ...(Platform.OS === "web" ? { height: 64 } : {}),
          },
          tabBarItemStyle: { alignSelf: "center" },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tabs.Screen
          name="watchlist"
          options={{
            title: "Watchlist",
            tabBarIcon: ({ color }) => <TabIcon name="view-list" color={color} />,
          }}
        />
        <Tabs.Screen
          name="chart"
          options={{
            title: "Chart",
            tabBarIcon: ({ color }) => <TabIcon name="chart-line" color={color} />,
          }}
        />
        <Tabs.Screen
          name="positions"
          options={{
            title: "Positions",
            tabBarIcon: ({ color }) => <TabIcon name="briefcase-variant" color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ color }) => <TabIcon name="history" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color }) => <TabIcon name="cog-outline" color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

// Silence unused-style warnings on web; nothing to export otherwise.
export const _styles = StyleSheet.create({});
