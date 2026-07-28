import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { C } from '../src/theme';
import { StatusBarFaux, BackRow } from '../src/components';
import { CapLabel, OfflineBanner } from '../src/ui';
import { usePoll, useContext } from '../src/hooks';
import { api } from '../src/api';

export default function RepoPicker() {
  const { data, offline } = usePoll(() => api.repos(), 5000);
  const { context } = useContext();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);

  const repos = (data && data.repos) || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? repos.filter((r) => r.name.toLowerCase().includes(s)) : repos;
  }, [repos, q]);

  const pinned = filtered.filter((r) => r.pinned);
  const recent = filtered.filter((r) => !r.pinned && r.recent);
  const all = filtered.filter((r) => !r.pinned && !r.recent);

  async function choose(repo) {
    setBusy(repo.name);
    try {
      await api.setContext({
        repo: repo.name,
        baseBranch: repo.defaultBranch || 'main',
        workBranch: context?.workBranch || null,
      });
      router.back();
    } catch (e) {
      setBusy(null);
    }
  }

  function Item({ repo, icon, iconColor, dim }) {
    return (
      <Pressable style={styles.item} onPress={() => choose(repo)}>
        {icon ? (
          <Text style={[styles.icon, iconColor && { color: iconColor }]}>{icon}</Text>
        ) : null}
        <Text style={[styles.name, dim && { color: C.text2 }]} numberOfLines={1}>
          {repo.name}
        </Text>
        {busy === repo.name && <ActivityIndicator size="small" color={C.accent} />}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Choose a repo" />
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Text style={{ color: C.muted }}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="search a repo name…"
            placeholderTextColor={C.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
          />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {repos.length === 0 && (
          <Text style={styles.empty}>
            {offline ? 'Waiting for backend…' : 'No repos returned.'}
          </Text>
        )}
        {pinned.length > 0 && (
          <>
            <CapLabel>Pinned</CapLabel>
            {pinned.map((r) => (
              <Item key={r.name} repo={r} icon="★" iconColor={C.needsyou} />
            ))}
          </>
        )}
        {recent.length > 0 && (
          <>
            <CapLabel style={{ marginTop: 16 }}>Recent</CapLabel>
            {recent.map((r) => (
              <Item key={r.name} repo={r} icon="↻" iconColor={C.muted} />
            ))}
          </>
        )}
        {all.length > 0 && (
          <>
            <CapLabel style={{ marginTop: 16 }}>All · {all.length}</CapLabel>
            {all.map((r) => (
              <Item key={r.name} repo={r} dim />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  searchWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 6 },
  search: {
    height: 44,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 14, outlineStyle: 'none' },
  body: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 6 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  icon: { fontSize: 14 },
  name: { flex: 1, fontSize: 15, color: C.text },
  empty: { color: C.muted, fontSize: 13, paddingVertical: 24 },
});
