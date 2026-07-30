import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C } from '../src/theme';
import { StatusBarFaux, BackRow } from '../src/components';
import { OfflineBanner } from '../src/ui';
import { PressableScale, FadeIn } from '../src/anim';
import { usePoll, useContext } from '../src/hooks';
import { api } from '../src/api';

export default function Issues() {
  const { context } = useContext();
  const repo = context?.repo;
  const { data, offline } = usePoll(() => (repo ? api.issues(repo) : Promise.resolve({ issues: [] })), 2500, [repo]);
  const issues = (data && data.issues) || [];
  const loading = data ? data.loading : true;
  const [creating, setCreating] = useState(null);

  async function dispatch(issue) {
    if (creating) return;
    setCreating(issue.number);
    try {
      const res = await api.createTask({
        promptText: `Fix issue #${issue.number}: ${issue.title}`,
        repo,
        baseBranch: context?.baseBranch || null,
        workBranch: context?.workBranch || null,
        mode: 'build',
      });
      const t = res && res.task;
      router.replace(t ? `/tasks/${t.id}` : '/(tabs)');
    } catch (e) {
      setCreating(null);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="GitHub issues" />
      <View style={styles.repoLine}>
        <Feather name="github" size={13} color={C.text2} />
        <Text style={styles.repoTxt} numberOfLines={1}>{repo || 'No repo selected'}</Text>
      </View>
      {!repo ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Select a repo first, then dispatch an issue from here.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
          <Text style={styles.hint}>Tap an issue to dispatch it — the agent pulls the issue and opens a PR.</Text>
          {issues.length === 0 ? (
            <View style={styles.center}>
              {loading ? <ActivityIndicator color={C.accent} /> : <Text style={styles.empty}>No open issues 🎉</Text>}
              {loading ? <Text style={styles.emptySub}>Fetching open issues…</Text> : null}
            </View>
          ) : (
            issues.map((it, i) => (
              <FadeIn key={it.number} delay={Math.min(i, 8) * 40}>
                <PressableScale style={styles.row} onPress={() => dispatch(it)} scaleTo={0.985}>
                  <View style={styles.numBox}>
                    <Text style={styles.num}>#{it.number}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{it.title}</Text>
                    {Array.isArray(it.labels) && it.labels.length > 0 && (
                      <View style={styles.labels}>
                        {it.labels.slice(0, 3).map((l) => (
                          <View key={l} style={styles.label}><Text style={styles.labelTxt}>{l}</Text></View>
                        ))}
                      </View>
                    )}
                  </View>
                  {creating === it.number ? (
                    <ActivityIndicator color={C.accent} style={{ marginLeft: 4 }} />
                  ) : (
                    <Feather name="arrow-up-right" size={18} color={C.accent} style={{ marginLeft: 2 }} />
                  )}
                </PressableScale>
              </FadeIn>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  repoLine: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingBottom: 8 },
  repoTxt: { fontSize: 13, color: C.text2, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 28 },
  hint: { fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 18 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  empty: { fontSize: 14, color: C.text2, textAlign: 'center' },
  emptySub: { fontSize: 12.5, color: C.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  numBox: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  num: { fontSize: 12, color: C.text2, fontWeight: '700' },
  title: { fontSize: 14.5, color: C.text, fontWeight: '600', lineHeight: 20 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  label: { backgroundColor: C.accentSoft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  labelTxt: { fontSize: 10.5, color: C.accent, fontWeight: '700' },
});
