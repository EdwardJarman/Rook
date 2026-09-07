import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Card, StatusPill } from "@/components/rook-primitives";
import { rookAlert, rookConfirm } from "@/lib/rook-alert";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

export function GithubConnectionCard() {
  const { colors, dark } = useRookTheme();
  const githubInk = dark ? "#EDEBE6" : "#24292F";
  const utils = trpc.useUtils();
  const status = trpc.github.status.useQuery(undefined, { retry: 1 });
  const authorize = trpc.github.authorizationUrl.useMutation();
  const disconnect = trpc.github.disconnect.useMutation();
  const selectRepo = trpc.github.selectRepo.useMutation();
  const unselectRepo = trpc.github.unselectRepo.useMutation();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [search, setSearch] = useState("");

  const repos = trpc.github.repos.useQuery(undefined, {
    enabled: browserOpen && status.data?.connected === true,
    retry: 1,
    staleTime: 60_000,
  });

  const returnTo = useMemo(() => {
    if (Platform.OS === "web" && typeof window !== "undefined")
      return `${window.location.origin}/account`;
    return Linking.createURL("/account");
  }, []);

  const refresh = async () => {
    await Promise.all([
      utils.github.status.invalidate(),
      utils.github.repos.invalidate(),
    ]);
  };

  const connectGithub = async () => {
    try {
      const url = await authorize.mutateAsync({ returnTo });
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      await WebBrowser.openAuthSessionAsync(url, returnTo);
      await refresh();
    } catch (error) {
      rookAlert(
        "GitHub unavailable",
        error instanceof Error
          ? error.message
          : "Rook could not start the GitHub connection.",
      );
    }
  };

  const disconnectGithub = () => {
    rookConfirm(
      "Disconnect GitHub?",
      "Rook will delete its stored GitHub tokens and your selected repositories immediately. Nothing in GitHub is changed.",
      () => {
        setBrowserOpen(false);
        void disconnect
          .mutateAsync()
          .then(refresh)
          .catch(() =>
            rookAlert(
              "Disconnect failed",
              "Rook could not remove this connection. Please try again.",
            ),
          );
      },
      { confirmLabel: "Disconnect", destructive: true },
    );
  };

  const addRepo = (fullName: string) => {
    void selectRepo
      .mutateAsync({ fullName })
      .then(refresh)
      .catch((error) =>
        rookAlert(
          "Could not add repository",
          error instanceof Error ? error.message : "Please try again.",
        ),
      );
  };

  const removeRepo = (fullName: string) => {
    void unselectRepo
      .mutateAsync({ fullName })
      .then(refresh)
      .catch(() =>
        rookAlert("Could not remove repository", "Please try again."),
      );
  };

  const connected = status.data?.connected === true;
  const needsReauthorization = status.data?.needsReauthorization === true;
  const selected = status.data?.selectedRepos ?? [];
  const term = search.trim().toLowerCase();
  const candidateRepos = (repos.data ?? []).filter(
    (repo) => !term || repo.fullName.toLowerCase().includes(term),
  );

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.appIcon,
            { backgroundColor: tint(githubInk, dark ? 0.16 : 0.08) },
          ]}
        >
          <MaterialIcons name="code" size={22} color={githubInk} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>GitHub</Text>
          <Text
            numberOfLines={2}
            style={[styles.subtitle, { color: colors.textFaint }]}
          >
            Pick repositories for your Bots to read while you chat.
          </Text>
        </View>
        {status.isLoading ? (
          <ActivityIndicator size="small" color={colors.textFaint} />
        ) : (
          <StatusPill
            label={
              connected
                ? "Connected"
                : needsReauthorization
                  ? "Reconnect"
                  : status.data?.configured
                    ? "Available"
                    : "Setup needed"
            }
            tone={connected ? "mint" : needsReauthorization ? "amber" : "muted"}
          />
        )}
      </View>

      {connected ? (
        <>
          <View style={styles.accountRow}>
            <Text style={[styles.accountLogin, { color: colors.text }]}>
              {status.data?.displayName ||
                status.data?.login ||
                "GitHub account"}
            </Text>
            <Text style={[styles.accountMeta, { color: colors.textFaint }]}>
              @{status.data?.login ?? "github"} · read-only repository access
            </Text>
          </View>

          {selected.length ? (
            <View style={styles.repoList}>
              <Text style={[styles.repoListTitle, { color: colors.textFaint }]}>
                Repositories your Bots can read ({selected.length}/25)
              </Text>
              {selected.map((repo) => (
                <View
                  key={repo.fullName}
                  style={[
                    styles.repoRow,
                    {
                      borderColor: colors.line,
                      backgroundColor: colors.surfaceAlt,
                    },
                  ]}
                >
                  <View style={styles.repoCopy}>
                    <Text
                      numberOfLines={1}
                      style={[styles.repoName, { color: colors.text }]}
                    >
                      {repo.fullName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.repoMeta, { color: colors.textFaint }]}
                    >
                      {repo.privateRepo ? "Private" : "Public"}
                      {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ""}
                      {repo.description ? ` · ${repo.description}` : ""}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${repo.fullName} from the working set`}
                    onPress={() => removeRepo(repo.fullName)}
                    style={({ pressed }) => ({
                      padding: 6,
                      opacity: pressed ? 0.55 : 1,
                    })}
                  >
                    <MaterialIcons
                      name="close"
                      size={16}
                      color={colors.textFaint}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyNote, { color: colors.textSoft }]}>
              No repositories selected yet. Add one or more below and your Bots
              can read their files in chat.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => setBrowserOpen((open) => !open)}
            style={({ pressed }) => [
              styles.secondaryAction,
              { borderColor: colors.line, backgroundColor: colors.surfaceAlt },
              pressed ? styles.pressed : null,
            ]}
          >
            <MaterialIcons
              name={browserOpen ? "expand-less" : "library-add"}
              size={15}
              color={colors.text}
            />
            <Text style={[styles.secondaryActionText, { color: colors.text }]}>
              {browserOpen ? "Hide repositories" : "Add repositories"}
            </Text>
          </Pressable>

          {browserOpen ? (
            <View style={styles.browser}>
              <View
                style={[
                  styles.searchShell,
                  {
                    borderColor: colors.line,
                    backgroundColor: colors.surfaceAlt,
                  },
                ]}
              >
                <MaterialIcons
                  name="search"
                  size={15}
                  color={colors.textFaint}
                />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search your repositories"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.searchInput, { color: colors.text }]}
                />
              </View>
              {repos.isLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.textFaint} />
                  <Text
                    style={[styles.loadingText, { color: colors.textFaint }]}
                  >
                    Loading repositories from GitHub…
                  </Text>
                </View>
              ) : repos.isError ? (
                <Text style={[styles.loadingText, { color: colors.coral }]}>
                  Could not list repositories.{" "}
                  {needsReauthorization
                    ? "Reconnect GitHub and try again."
                    : "Please try again."}
                </Text>
              ) : (
                <ScrollView
                  style={{ maxHeight: 260 }}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.repoList}>
                    {candidateRepos.slice(0, 60).map((repo) => {
                      const isPicked = selected.some(
                        (picked) =>
                          picked.fullName.toLowerCase() ===
                          repo.fullName.toLowerCase(),
                      );
                      return (
                        <Pressable
                          key={repo.fullName}
                          accessibilityRole="button"
                          accessibilityLabel={`${isPicked ? "Remove" : "Add"} ${repo.fullName}`}
                          onPress={() =>
                            isPicked
                              ? removeRepo(repo.fullName)
                              : addRepo(repo.fullName)
                          }
                          style={({ pressed }) => [
                            styles.repoRow,
                            {
                              borderColor: isPicked
                                ? tint(colors.accent, 0.4)
                                : colors.line,
                              backgroundColor: isPicked
                                ? tint(colors.accent, dark ? 0.12 : 0.05)
                                : colors.surfaceAlt,
                            },
                            pressed ? styles.pressed : null,
                          ]}
                        >
                          <View style={styles.repoCopy}>
                            <Text
                              numberOfLines={1}
                              style={[styles.repoName, { color: colors.text }]}
                            >
                              {repo.fullName}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.repoMeta,
                                { color: colors.textFaint },
                              ]}
                            >
                              {repo.privateRepo ? "Private" : "Public"}
                              {repo.language ? ` · ${repo.language}` : ""}
                              {repo.updatedAt
                                ? ` · pushed ${new Date(repo.updatedAt).toLocaleDateString()}`
                                : ""}
                            </Text>
                          </View>
                          <MaterialIcons
                            name={
                              isPicked ? "check-circle" : "add-circle-outline"
                            }
                            size={19}
                            color={isPicked ? colors.accent : colors.textFaint}
                          />
                        </Pressable>
                      );
                    })}
                    {!candidateRepos.length ? (
                      <Text
                        style={[
                          styles.loadingText,
                          { color: colors.textFaint },
                        ]}
                      >
                        No matching repositories in the first 200 Rook found.
                      </Text>
                    ) : null}
                  </View>
                </ScrollView>
              )}
              <Text style={[styles.browserNote, { color: colors.textFaint }]}>
                Rook lists repositories your GitHub account can access. Access
                is read-only.
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={disconnectGithub}
            style={({ pressed }) => [
              styles.quietAction,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.quietActionText, { color: colors.textFaint }]}>
              Disconnect GitHub
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.explainer, { color: colors.textSoft }]}>
            {needsReauthorization
              ? "Rook's GitHub access expired. Reconnect to keep working with your repositories."
              : "Sign in with GitHub to let your Bots read the repositories you choose. Rook never asks for your password and never writes to your repositories."}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={authorize.isPending}
            onPress={() => void connectGithub()}
            style={({ pressed }) => [
              styles.primaryAction,
              { backgroundColor: colors.text },
              authorize.isPending
                ? { opacity: 0.5 }
                : pressed
                  ? styles.pressed
                  : null,
            ]}
          >
            {authorize.isPending ? (
              <ActivityIndicator size="small" color={colors.canvas} />
            ) : (
              <MaterialIcons name="login" size={16} color={colors.canvas} />
            )}
            <Text style={[styles.primaryActionText, { color: colors.canvas }]}>
              {needsReauthorization ? "Reconnect GitHub" : "Connect GitHub"}
            </Text>
          </Pressable>
          {!status.data?.configured ? (
            <Text style={[styles.browserNote, { color: colors.textFaint }]}>
              {status.data?.missingEnv?.length
                ? `Setup needed on this deployment: missing ${status.data.missingEnv.join(", ")}. Redeploy after adding them — Vercel only applies new env vars to new deployments.`
                : "Setup needed on this deployment: add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."}
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  appIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14.5, lineHeight: 19, fontWeight: "700" },
  subtitle: { fontSize: 11.5, lineHeight: 15.5, marginTop: 2 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 2,
  },
  accountLogin: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  accountMeta: { fontSize: 11, lineHeight: 15 },
  repoList: { gap: 7 },
  repoListTitle: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 2,
  },
  repoRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  repoCopy: { flex: 1, minWidth: 0 },
  repoName: { fontSize: 12.5, lineHeight: 16, fontWeight: "600" },
  repoMeta: { fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  emptyNote: { fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  secondaryAction: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 13,
  },
  secondaryActionText: { fontSize: 12.5, fontWeight: "600" },
  browser: { gap: 10 },
  searchShell: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
  },
  searchInput: { flex: 1, minHeight: 38, fontSize: 12.5, paddingVertical: 6 },
  loadingRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  loadingText: { fontSize: 11.5, lineHeight: 16 },
  browserNote: { fontSize: 10.5, lineHeight: 15 },
  quietAction: {
    alignSelf: "center",
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  quietActionText: { fontSize: 11.5, fontWeight: "600" },
  explainer: { fontSize: 12.5, lineHeight: 18.5, paddingHorizontal: 2 },
  primaryAction: {
    minHeight: 46,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 15,
  },
  primaryActionText: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
