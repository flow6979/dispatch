import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { CapLabel, Dot, OfflineBanner } from '../../src/ui';
import { useHealth } from '../../src/hooks';

function Row({ label, value, children, first }) {
  return (
    <View style={[styles.row, first && { borderTopWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children || <Text style={styles.rowVal}>{value}</Text>}
    </View>
  );
}

export default function Settings() {
  const { health, offline } = useHealth();
  const [push, setPush] = useState(true);
  const [quiet, setQuiet] = useState(true);

  const runners = health?.runners ?? 0;
  const online = !offline && runners > 0;

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Settings" onBack={false} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <CapLabel style={styles.head}>Runners</CapLabel>
        <View style={styles.row}>
          <Dot status={online ? 'ready' : 'blocked'} style={{ marginRight: 11 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>
              {online ? 'MacBook Pro' : 'No runner connected'}
            </Text>
            <Text style={styles.rowSub}>
              {offline
                ? 'backend offline'
                : `${runners} runner${runners === 1 ? '' : 's'} · ~/dispatch-workspace`}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: C.accent }]}>
            + Pair another machine
          </Text>
        </View>

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
        <Row label="GitHub" value="flow6979" />
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
});
