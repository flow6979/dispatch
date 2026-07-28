import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { C, statusOf } from '../../src/theme';
import { StatusBarFaux, BackRow, TaskRow } from '../../src/components';
import { OfflineBanner } from '../../src/ui';
import { useTasks } from '../../src/hooks';

const GROUPS = [
  { key: 'needsyou', title: 'Needs you', glyph: '⚠', color: C.needsyou },
  { key: 'running', title: 'Running', glyph: '●', color: C.running },
  { key: 'ready', title: 'Ready to review', glyph: '✓', color: C.ready },
  { key: 'blocked', title: 'Done / Blocked', glyph: '', color: C.muted },
];

export default function TaskBoard() {
  const { tasks, offline } = useTasks();

  const buckets = { needsyou: [], running: [], ready: [], blocked: [], queued: [] };
  tasks.forEach((t) => {
    const s = statusOf(t.state);
    (buckets[s] || buckets.blocked).push(t);
  });
  // queued tasks fold into blocked/done group tail (nothing needs the user)
  buckets.blocked = buckets.blocked.concat(buckets.queued);

  const anything = tasks.length > 0;

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Tasks" onBack={false} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {!anything && (
          <Text style={styles.empty}>
            {offline ? 'Waiting for backend…' : 'No tasks yet.'}
          </Text>
        )}
        {GROUPS.map((g) => {
          const items = buckets[g.key];
          if (!items || items.length === 0) return null;
          return (
            <View key={g.key}>
              <Text style={[styles.groupHdr, { color: g.color }]}>
                {g.glyph ? `${g.glyph} ` : ''}
                {g.title} · {items.length}
              </Text>
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onPress={() =>
                    statusOf(t.state) === 'needsyou' && t.state === 'SPEC_DRAFTED'
                      ? router.push(`/spec/${t.id}`)
                      : router.push(`/tasks/${t.id}`)
                  }
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  groupHdr: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  empty: { color: C.muted, fontSize: 13, paddingVertical: 24 },
});
