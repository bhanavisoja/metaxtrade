// Design tokens for ApexFX Trading. Light (white) theme — matches the
// user's requirement to replace the pink background with a clean white
// trading terminal look (navy text, orange brand accent, red/green PnL).
//
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FFFFFF",
  onSurface: "#0E1116",
  surfaceSecondary: "#F7F9FC",
  onSurfaceSecondary: "#1E2733",
  surfaceTertiary: "#EEF2F7",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#0E1116",
  onSurfaceInverse: "#FFFFFF",
  muted: "#8B949E",

  // Brand (warm trading orange from design guidelines)
  brand: "#FF5722",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF5722",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E64A19",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "rgba(255, 87, 34, 0.12)",
  onBrandTertiary: "#FF5722",

  // Trading-specific semantic colors
  success: "#1B8E3F", // buy / profit green
  onSuccess: "#FFFFFF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#D32F2F", // sell / loss red
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E3E8EF",
  borderStrong: "#CBD5E1",
  divider: "#EEF2F7",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Shared spacing + radius tokens (align with design_guidelines.json)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};
