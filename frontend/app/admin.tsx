// Admin panel route. Password gate (local), then shows two tabs:
//   • Users    — list, add, edit, deactivate
//   • Settings — broker name/tagline/logo, commission, allow_funds toggle
// Admin bearer token is kept in secure storage (`AUTH_KEY` for admin).

import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type AdminUser } from "@/src/api/client";
import { Icon } from "@/src/components/icon";
import { refreshBrokerSettings } from "@/src/prefs/broker-settings";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const ADMIN_TOKEN_KEY = "apexfx_admin_token";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  back: { padding: spacing.xs },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800", flex: 1 },
  logoutLink: { color: colors.error, fontSize: 13, fontWeight: "700" },

  loginBox: {
    margin: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loginTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: spacing.sm },
  loginSub: { color: colors.muted, fontSize: 12, marginBottom: spacing.lg },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? spacing.sm : 6,
    fontSize: 14,
    color: colors.onSurface,
  },
  primaryBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800" },
  error: { color: colors.error, fontSize: 12, marginTop: spacing.sm },

  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.brandPrimary },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: colors.onSurface },

  section: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  sectionTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  toggleHint: { color: colors.muted, fontSize: 11, marginTop: 2 },

  userRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  userTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  userId: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  userMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  editBtn: { borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  editBtnText: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  dangerBtn: { borderColor: colors.error, backgroundColor: colors.surface },
  dangerBtnText: { color: colors.error, fontSize: 12, fontWeight: "700" },

  addCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.md,
  },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  twoColCell: { flex: 1 },

  banner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  bannerSuccess: { backgroundColor: colors.success },
  bannerError: { backgroundColor: colors.error },
  bannerText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
}));

type Tab = "users" | "settings";

export default function AdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("users");

  useEffect(() => {
    (async () => {
      const stored = await storage.secureGet<string | null>(ADMIN_TOKEN_KEY, null);
      setToken(stored ?? null);
      setLoaded(true);
    })();
  }, []);

  const logout = async () => {
    await storage.secureRemove(ADMIN_TOKEN_KEY);
    setToken(null);
  };

  if (!loaded) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="admin-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} testID="admin-back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Broker Admin</Text>
        {token ? (
          <Pressable onPress={logout} testID="admin-logout">
            <Text style={styles.logoutLink}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>

      {!token ? (
        <AdminLogin
          onLoggedIn={async (t) => {
            await storage.secureSet(ADMIN_TOKEN_KEY, t);
            setToken(t);
          }}
        />
      ) : (
        <>
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tab, tab === "users" && styles.tabActive]}
              onPress={() => setTab("users")}
              testID="admin-tab-users"
            >
              <Text style={[styles.tabText, tab === "users" && styles.tabTextActive]}>Users</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === "settings" && styles.tabActive]}
              onPress={() => setTab("settings")}
              testID="admin-tab-settings"
            >
              <Text style={[styles.tabText, tab === "settings" && styles.tabTextActive]}>
                Branding & Settings
              </Text>
            </Pressable>
          </View>
          {tab === "users" ? (
            <UsersTab token={token} onAuthError={logout} />
          ) : (
            <SettingsTab token={token} onAuthError={logout} />
          )}
        </>
      )}
    </View>
  );
}

function AdminLogin({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminLogin(password);
      onLoggedIn(res.token);
    } catch (e: any) {
      setError(e?.message || "Invalid password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.loginBox} testID="admin-login">
      <Text style={styles.loginTitle}>Admin login</Text>
      <Text style={styles.loginSub}>
        Default password is <Text style={{ fontWeight: "800" }}>admin123</Text>. Change the
        `ADMIN_PASSWORD` env var in production.
      </Text>
      <Text style={styles.label}>Admin password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="admin-password-input"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.primaryBtn} onPress={submit} disabled={loading} testID="admin-login-submit">
        {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>SIGN IN</Text>}
      </Pressable>
    </View>
  );
}

function UsersTab({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [newId, setNewId] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [newMaxLots, setNewMaxLots] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newSupport, setNewSupport] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.adminListUsers(token);
      setUsers(data);
    } catch (e: any) {
      if (String(e.message).includes("expired")) onAuthError();
      setNotice({ type: "error", text: e?.message || "Failed to load users" });
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!newId.trim() || !newPwd.trim()) {
      setNotice({ type: "error", text: "User ID and password required" });
      return;
    }
    try {
      await api.adminUpsertUser(token, {
        user_id: newId.trim(),
        password: newPwd.trim(),
        name: newName.trim() || null,
        balance_override: newBalance ? parseFloat(newBalance) : null,
        max_lots_override: newMaxLots ? parseFloat(newMaxLots) : null,
        social_trading_url: newSocial.trim() || null,
        support_url: newSupport.trim() || null,
      });
      setNotice({ type: "success", text: `User ${newId} created` });
      setNewId("");
      setNewPwd("");
      setNewName("");
      setNewBalance("");
      setNewMaxLots("");
      setNewSocial("");
      setNewSupport("");
      await load();
    } catch (e: any) {
      setNotice({ type: "error", text: e?.message || "Failed" });
    }
  };

  return (
    <KeyboardAwareScrollView keyboardShouldPersistTaps="handled">
      {notice ? (
        <View style={[styles.banner, notice.type === "success" ? styles.bannerSuccess : styles.bannerError]}>
          <Text style={styles.bannerText}>{notice.text}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CREATE TRADING ACCOUNT</Text>
        <View style={styles.addCard}>
          <View style={styles.twoCol}>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Trading ID</Text>
              <TextInput
                style={styles.input}
                value={newId}
                onChangeText={setNewId}
                autoCapitalize="none"
                testID="admin-new-user-id"
              />
            </View>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={newPwd}
                onChangeText={setNewPwd}
                secureTextEntry
                testID="admin-new-user-password"
              />
            </View>
          </View>
          <Text style={styles.label}>Trader name (optional)</Text>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            testID="admin-new-user-name"
          />
          <View style={styles.twoCol}>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Starting balance ($)</Text>
              <TextInput
                style={styles.input}
                value={newBalance}
                onChangeText={setNewBalance}
                keyboardType="decimal-pad"
                testID="admin-new-user-balance"
              />
            </View>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Max lots (optional)</Text>
              <TextInput
                style={styles.input}
                value={newMaxLots}
                onChangeText={setNewMaxLots}
                keyboardType="decimal-pad"
                testID="admin-new-user-maxlots"
              />
            </View>
          </View>
          <Text style={styles.label}>Social Trading URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={newSocial}
            onChangeText={setNewSocial}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID="admin-new-user-social"
          />
          <Text style={styles.label}>Customer Support URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={newSupport}
            onChangeText={setNewSupport}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID="admin-new-user-support"
          />
          <Pressable style={styles.primaryBtn} onPress={create} testID="admin-create-user">
            <Text style={styles.primaryBtnText}>CREATE ACCOUNT</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>EXISTING ACCOUNTS ({users.length})</Text>
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : users.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>No accounts yet.</Text>
        ) : (
          users.map((u) => (
            <UserRow key={u.user_id} user={u} token={token} onChanged={load} onNotice={setNotice} />
          ))
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

function UserRow({
  user,
  token,
  onChanged,
  onNotice,
}: {
  user: AdminUser;
  token: string;
  onChanged: () => Promise<void>;
  onNotice: (n: { type: "success" | "error"; text: string }) => void;
}) {
  const styles = useStyles();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(user.name ?? "");
  const [balance, setBalance] = useState(
    user.balance_override != null ? String(user.balance_override) : "",
  );
  const [maxLots, setMaxLots] = useState(
    user.max_lots_override != null ? String(user.max_lots_override) : "",
  );
  const [socialUrl, setSocialUrl] = useState(user.social_trading_url ?? "");
  const [supportUrl, setSupportUrl] = useState(user.support_url ?? "");

  const save = async () => {
    try {
      await api.adminUpsertUser(token, {
        user_id: user.user_id,
        password: password.trim() || undefined,
        name: name.trim() || null,
        balance_override: balance ? parseFloat(balance) : null,
        max_lots_override: maxLots ? parseFloat(maxLots) : null,
        social_trading_url: socialUrl.trim() || null,
        support_url: supportUrl.trim() || null,
      });
      onNotice({ type: "success", text: `${user.user_id} updated` });
      setEditing(false);
      setPassword("");
      await onChanged();
    } catch (e: any) {
      onNotice({ type: "error", text: e?.message || "Failed" });
    }
  };

  const remove = async () => {
    try {
      await api.adminDeleteUser(token, user.user_id);
      onNotice({ type: "success", text: `${user.user_id} removed` });
      await onChanged();
    } catch (e: any) {
      onNotice({ type: "error", text: e?.message || "Failed" });
    }
  };

  return (
    <View style={styles.userRow} testID={`admin-user-${user.user_id}`}>
      <View style={styles.userTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.userId}>{user.user_id}</Text>
          <Text style={styles.userMeta}>
            {user.name || "—"} · balance ${user.balance_override?.toFixed(2) ?? "—"} · max lots{" "}
            {user.max_lots_override?.toFixed(2) ?? "auto"}
          </Text>
        </View>
      </View>
      {editing ? (
        <>
          <Text style={styles.label}>Trader name (shown in the app)</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            testID={`admin-user-name-${user.user_id}`}
          />
          <Text style={styles.label}>New password (leave blank to keep)</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            testID={`admin-user-password-${user.user_id}`}
          />
          <View style={styles.twoCol}>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Balance override</Text>
              <TextInput
                style={styles.input}
                value={balance}
                onChangeText={setBalance}
                keyboardType="decimal-pad"
                testID={`admin-user-balance-${user.user_id}`}
              />
            </View>
            <View style={styles.twoColCell}>
              <Text style={styles.label}>Max lots</Text>
              <TextInput
                style={styles.input}
                value={maxLots}
                onChangeText={setMaxLots}
                keyboardType="decimal-pad"
                testID={`admin-user-maxlots-${user.user_id}`}
              />
            </View>
          </View>
          <Text style={styles.label}>Social Trading URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={socialUrl}
            onChangeText={setSocialUrl}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID={`admin-user-social-${user.user_id}`}
          />
          <Text style={styles.label}>Customer Support URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={supportUrl}
            onChangeText={setSupportUrl}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID={`admin-user-support-${user.user_id}`}
          />
          <Pressable style={styles.primaryBtn} onPress={save} testID={`admin-user-save-${user.user_id}`}>
            <Text style={styles.primaryBtnText}>SAVE CHANGES</Text>
          </Pressable>
        </>
      ) : null}
      <View style={styles.rowActions}>
        <Pressable
          style={[styles.smallBtn, styles.editBtn]}
          onPress={() => setEditing((v) => !v)}
          testID={`admin-user-edit-${user.user_id}`}
        >
          <Text style={styles.editBtnText}>{editing ? "Cancel" : "Edit"}</Text>
        </Pressable>
        <Pressable
          style={[styles.smallBtn, styles.dangerBtn]}
          onPress={remove}
          testID={`admin-user-delete-${user.user_id}`}
        >
          <Text style={styles.dangerBtnText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsTab({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const styles = useStyles();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [brokerName, setBrokerName] = useState("");
  const [brokerTagline, setBrokerTagline] = useState("");
  const [brokerLogo, setBrokerLogo] = useState("");
  const [commission, setCommission] = useState("");
  const [allowFunds, setAllowFunds] = useState(true);
  const [socialDefault, setSocialDefault] = useState("");
  const [supportDefault, setSupportDefault] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.adminSettings(token);
      setBrokerName(s.broker_name ?? "");
      setBrokerTagline(s.broker_tagline ?? "");
      setBrokerLogo(s.broker_logo_url ?? "");
      setCommission(s.commission_per_lot != null ? String(s.commission_per_lot) : "");
      setAllowFunds(Boolean(s.allow_funds));
      setSocialDefault(s.social_trading_url_default ?? "");
      setSupportDefault(s.support_url_default ?? "");
    } catch (e: any) {
      if (String(e.message).includes("expired")) onAuthError();
      setNotice({ type: "error", text: e?.message || "Failed to load settings" });
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      await api.adminUpdateSettings(token, {
        broker_name: brokerName,
        broker_tagline: brokerTagline || null,
        broker_logo_url: brokerLogo || null,
        commission_per_lot: commission ? parseFloat(commission) : 20.0,
        allow_funds: allowFunds,
        social_trading_url_default: socialDefault || null,
        support_url_default: supportDefault || null,
      });
      setNotice({ type: "success", text: "Settings saved" });
      await refreshBrokerSettings();
    } catch (e: any) {
      setNotice({ type: "error", text: e?.message || "Failed" });
    }
  };

  return (
    <KeyboardAwareScrollView keyboardShouldPersistTaps="handled">
      {notice ? (
        <View style={[styles.banner, notice.type === "success" ? styles.bannerSuccess : styles.bannerError]}>
          <Text style={styles.bannerText}>{notice.text}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ padding: spacing.lg }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>BRANDING (shown on login + settings)</Text>
          <Text style={styles.label}>Broker name</Text>
          <TextInput
            style={styles.input}
            value={brokerName}
            onChangeText={setBrokerName}
            testID="admin-settings-broker-name"
          />
          <Text style={styles.label}>Tagline (optional)</Text>
          <TextInput
            style={styles.input}
            value={brokerTagline}
            onChangeText={setBrokerTagline}
            testID="admin-settings-broker-tagline"
          />
          <Text style={styles.label}>Logo URL (optional PNG/JPG)</Text>
          <TextInput
            style={styles.input}
            value={brokerLogo}
            onChangeText={setBrokerLogo}
            autoCapitalize="none"
            keyboardType="url"
            testID="admin-settings-broker-logo"
          />

          <Text style={styles.sectionTitle}>TRADING</Text>
          <Text style={styles.label}>Commission per lot ($)</Text>
          <TextInput
            style={styles.input}
            value={commission}
            onChangeText={setCommission}
            keyboardType="decimal-pad"
            testID="admin-settings-commission"
          />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Allow deposits & withdrawals</Text>
              <Text style={styles.toggleHint}>
                When off, the Funds screen is hidden from traders and the Deposit/Withdraw rows in
                Settings are replaced by a notice.
              </Text>
            </View>
            <Switch
              value={allowFunds}
              onValueChange={setAllowFunds}
              testID="admin-settings-allow-funds"
            />
          </View>

          <Text style={styles.sectionTitle}>DEFAULT LINKS (used when a user has no override)</Text>
          <Text style={styles.label}>Social Trading URL (default)</Text>
          <TextInput
            style={styles.input}
            value={socialDefault}
            onChangeText={setSocialDefault}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID="admin-settings-social-default"
          />
          <Text style={styles.label}>Customer Support URL (default)</Text>
          <TextInput
            style={styles.input}
            value={supportDefault}
            onChangeText={setSupportDefault}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://..."
            testID="admin-settings-support-default"
          />

          <Pressable style={styles.primaryBtn} onPress={save} testID="admin-settings-save">
            <Text style={styles.primaryBtnText}>SAVE SETTINGS</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}
