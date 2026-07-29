import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, ActivityIndicator } from 'react-native';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { CapLabel, Dot, OfflineBanner } from '../../src/ui';
import { useRunners } from '../../src/hooks';
import { api } from '../../src/api';

function Row({ label, value, children, first }) {
  return (
    <View style={[styles.row, first && { borderTopWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children || <Text style={styles.rowVal}>{value}</Text>}
    </View>
  );
}

export default function Settings() {
  const { runners, offline, refresh } = useRunners();
  const [push, setPush] = useState(true);
  const [quiet, setQuiet] = useState(true);
  const [acting, setActing] = useState(null);

  const approved = runners.filter((r) => r.paired);
  const ghUser = (approved[0] || runners[0] || {}).ghUser || null;

  async function approve(id) {
    setActing(id);
    try { await api.approveRunner(id); refresh(); } catch (_) {} finally { setActing(null); }
  }
  async function revoke(id) {
    setActing(id);
    try { await api.revokeRunner(id); refresh(); } catch (_) {} finally { setActing(null); }
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Settings" onBack={false} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <CapLabel style={styles.head}>Runners</CapLabel>
        {runners.length === 0 && (
          <View style={styles.row}>
            <Dot status="blocked" style={{ marginRight: 11 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>No machine connected</Text>
              <Text style={styles.rowSub}>
                {offline ? 'backend offline' : 'start the runner on your laptop'}
              </Text>
            </View>
          </View>
        )}
        {runners.map((r) => (
          <View key={r.id} style={styles.row}>
            <Dot status={r.paired ? 'ready' : 'needsyou'} style={{ marginRight: 11 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.host || r.name}</Text>
              <Text style={styles.rowSub}>
                {r.ghUser ? `@${r.ghUser}` : 'unknown account'} ·{' '}
                {r.paired ? 'approved' : 'awaiting approval'}
              </Text>
            </View>
            {acting === r.id ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : r.paired ? (
              <Pressable onPress={() => revoke(r.id)}>
                <Text style={[styles.action, { color: C.muted }]}>Revoke</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => approve(r.id)}>
                <Text style={[styles.action, { color: C.accent }]}>Approve</Text>
              </Pressable>
            )}
          </View>
        ))}
        <Text style={styles.hint}>
          A machine must be approved here before it can run your tasks. To add one,
          start the Dispatch runner on it and approve it above.
        </Text>

        <CapLabel style={styles.head}>Notifications</CapLabel>
        <Row label="Push">
          <Switch
            value={push}
            onValueChange={setPush}
            trackColor={{ true: C.accent, false: C.surface2 }}
            thumbColor="#fff"
          />
        </Row>
        <Row label="Digest time" value="7:30 AM" />
        <Row label="Quiet hours">
          <Switch
            value={quiet}
            onValueChange={setQuiet}
            trackColor={{ true: C.accent, false: C.surface2 }}
            thumbColor="#fff"
          />
        </Row>

        <CapLabel style={styles.head}>Defaults</CapLabel>
        <Row label="Autonomy" value="Draft only" />
        <Row label="Task budget" value="250k tokens" />

        <CapLabel style={styles.head}>Account</CapLabel>
        <Row label="GitHub" value={ghUser ? `@${ghUser}` : 'not connected'} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  head: { marginTop: 18, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  rowLabel: { flex: 1, fontSize: 14, color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  rowVal: { fontSize: 14, color: C.text2 },
  action: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 18 },
});
