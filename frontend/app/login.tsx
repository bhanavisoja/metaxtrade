import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { useBrokerSettings } from "@/src/prefs/broker-settings";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    justifyContent: "center",
  },
  hero: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  logoText: {
    color: colors.onBrandPrimary,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: colors.onSurface,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
  },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === "ios" ? spacing.lg : spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.md,
  },
  button: {
    marginTop: spacing.xl,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  hint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.xl,
  },
}));

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const branding = useBrokerSettings();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = userId.trim().length > 0 && password.length > 0 && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await login(userId.trim(), password);
      router.replace("/(tabs)/watchlist");
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="login-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
      >
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            {branding.broker_logo_url ? (
              <Image
                source={{ uri: branding.broker_logo_url }}
                style={{ width: 72, height: 72, borderRadius: radius.lg }}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.logoText}>
                {(branding.broker_name || "FX").slice(0, 2).toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={styles.title} testID="login-broker-name">
            Welcome to {branding.broker_name || "MetaXtrade"}
          </Text>
          <Text style={styles.subtitle}>
            {branding.broker_tagline || "Sign in with your trading ID to access live markets, charts and positions."}
          </Text>
        </View>

        <Text style={styles.label}>Trading ID</Text>
        <TextInput
          testID="login-user-id-input"
          style={styles.input}
          value={userId}
          onChangeText={setUserId}
          placeholder="e.g. 3245615"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="default"
          returnKeyType="next"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          testID="login-password-input"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        {error ? (
          <Text style={styles.error} testID="login-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="login-submit-button"
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
