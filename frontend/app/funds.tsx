import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type FundTxn } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Icon } from "@/src/components/icon";
import { useBrokerSettings } from "@/src/prefs/broker-settings";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Mode = "deposit" | "withdraw";

const METHODS = ["Card", "Crypto", "Bank wire"] as const;
type Method = (typeof METHODS)[number];

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { padding: spacing.xs, marginRight: spacing.sm },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },

  balanceCard: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.onSurface,
  },
  balanceLabel: { color: colors.muted, fontSize: 11, letterSpacing: 0.6, fontWeight: "700" },
  balanceValue: {
    color: colors.surface,
    fontSize: 32,
    fontWeight: "800",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },

  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  modeChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modeChipText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "700" },
  modeChipTextActive: { color: colors.onBrandPrimary },

  section: { paddingHorizontal: spacing.lg },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },

  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  dollar: { color: colors.muted, fontSize: 24, fontWeight: "700" },
  amountInput: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? spacing.lg : spacing.md,
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
  },

  quickRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  quickChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  quickChipText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },

  methodsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  methodChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodChipActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  methodChipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  methodChipTextActive: { color: colors.surface },

  submitBtn: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  depositBtn: { backgroundColor: colors.success },
  withdrawBtn: { backgroundColor: colors.brandPrimary },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },

  message: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    fontSize: 13,
  },
  success: { backgroundColor: colors.success, color: "#FFFFFF" },
  error: { backgroundColor: colors.error, color: "#FFFFFF" },

  historyTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  historyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  historyIconDep: { backgroundColor: "rgba(27,142,63,0.12)" },
  historyIconWd: { backgroundColor: "rgba(211,47,47,0.12)" },
  historyBody: { flex: 1 },
  historyTitle2: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  historySub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  historyAmountDep: { color: colors.success, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  historyAmountWd: { color: colors.error, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },

  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: "center" },
}));

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function FundsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { user, refreshAccount } = useAuth();
  const branding = useBrokerSettings();

  const [mode, setMode] = useState<Mode>(params.mode === "withdraw" ? "withdraw" : "deposit");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("Card");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<FundTxn[]>([]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.fundHistory(user.user_id);
      setHistory(data);
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const amountNum = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const canSubmit = !!user && amountNum > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const call = mode === "deposit" ? api.deposit : api.withdraw;
      await call({
        user_id: user.user_id,
        amount: amountNum,
        method: method.toLowerCase(),
      });
      setMessage({
        type: "success",
        text: `${mode === "deposit" ? "Deposited" : "Withdrew"} $${amountNum.toFixed(2)} successfully`,
      });
      setAmount("");
      await refreshAccount();
      await loadHistory();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message || "Transaction failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="funds-screen">
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} testID="funds-back">
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Funds</Text>
      </View>

      {!branding.allow_funds ? (
        <View style={{ padding: spacing.xl, alignItems: "center" }}>
          <Icon name="information-outline" size={40} color={colors.muted} />
          <Text style={{ color: colors.onSurface, fontWeight: "800", marginTop: spacing.md }}>
            Funds management disabled
          </Text>
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>
            Please contact {branding.broker_name} to deposit or withdraw funds.
          </Text>
        </View>
      ) : (
      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={32}
      >
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceValue} testID="funds-balance">
            ${user?.balance?.toFixed(2) ?? "0.00"}
          </Text>
        </View>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeChip, mode === "deposit" && styles.modeChipActive]}
            onPress={() => setMode("deposit")}
            testID="funds-mode-deposit"
          >
            <Text style={[styles.modeChipText, mode === "deposit" && styles.modeChipTextActive]}>
              Deposit
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeChip, mode === "withdraw" && styles.modeChipActive]}
            onPress={() => setMode("withdraw")}
            testID="funds-mode-withdraw"
          >
            <Text style={[styles.modeChipText, mode === "withdraw" && styles.modeChipTextActive]}>
              Withdraw
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              testID="funds-amount-input"
            />
          </View>
          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((q) => (
              <Pressable
                key={q}
                style={styles.quickChip}
                onPress={() => setAmount(String(q))}
                testID={`funds-quick-${q}`}
              >
                <Text style={styles.quickChipText}>${q}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Method</Text>
          <View style={styles.methodsRow}>
            {METHODS.map((m) => {
              const active = method === m;
              return (
                <Pressable
                  key={m}
                  style={[styles.methodChip, active && styles.methodChipActive]}
                  onPress={() => setMethod(m)}
                  testID={`funds-method-${m.replace(/\s/g, "").toLowerCase()}`}
                >
                  <Text style={[styles.methodChipText, active && styles.methodChipTextActive]}>
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          style={[
            styles.submitBtn,
            mode === "deposit" ? styles.depositBtn : styles.withdrawBtn,
            !canSubmit && styles.submitDisabled,
          ]}
          onPress={submit}
          disabled={!canSubmit}
          testID="funds-submit-button"
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>
              {mode === "deposit" ? "DEPOSIT" : "WITHDRAW"} ${amountNum ? amountNum.toFixed(2) : "0.00"}
            </Text>
          )}
        </Pressable>

        {message ? (
          <Text
            style={[
              styles.message,
              message.type === "success" ? styles.success : styles.error,
            ]}
            testID="funds-message"
          >
            {message.text}
          </Text>
        ) : null}

        <Text style={styles.historyTitle}>RECENT TRANSACTIONS</Text>
        {history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No deposits or withdrawals yet.</Text>
          </View>
        ) : (
          <FlatList
            data={history}
            scrollEnabled={false}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => {
              const isDep = item.kind === "deposit";
              return (
                <View style={styles.historyRow} testID={`funds-history-${item.id}`}>
                  <View style={[styles.historyIcon, isDep ? styles.historyIconDep : styles.historyIconWd]}>
                    <Icon
                      name={isDep ? "arrow-down-bold" : "arrow-up-bold"}
                      size={18}
                      color={isDep ? colors.success : colors.error}
                    />
                  </View>
                  <View style={styles.historyBody}>
                    <Text style={styles.historyTitle2}>
                      {isDep ? "Deposit" : "Withdrawal"}
                      {item.method ? ` · ${item.method}` : ""}
                    </Text>
                    <Text style={styles.historySub}>{fmtDate(item.created_at)}</Text>
                  </View>
                  <Text style={isDep ? styles.historyAmountDep : styles.historyAmountWd}>
                    {isDep ? "+" : "-"}${item.amount.toFixed(2)}
                  </Text>
                </View>
              );
            }}
          />
        )}
      </KeyboardAwareScrollView>
      )}
    </View>
  );
}
