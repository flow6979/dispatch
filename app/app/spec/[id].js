import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { CapLabel, Card, Button, Meter, Dot, OfflineBanner } from '../../src/ui';
import { usePoll } from '../../src/hooks';
import { api } from '../../src/api';

export default function SpecConfirm() {
  const { id } = useLocalSearchParams();
  const { data, offline } = usePoll(() => api.task(id), 2000, [id]);
  const [acting, setActing] = useState(null);

  const task = data && data.task;
  const spec = task && task.spec;
  const confidence = spec && typeof spec.confidence === 'number' ? spec.confidence : 0.7;
  const risk = (spec && spec.risk) || 'low';
  const riskStatus = risk === 'high' ? 'blocked' : risk === 'medium' ? 'needsyou' : 'ready';

  async function go() {
    setActing('go');
    try {
      await api.confirm(id);
      router.replace(`/tasks/${id}`);
    } catch (e) {
      setActing(null);
    }
  }
  async function hold() {
    setActing('hold');
    try {
      await api.hold(id);
      router.back();
    } catch (e) {
      setActing(null);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Before I start" />
      {!task ? (
        <View style={styles.loading}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.loadingTxt}>
            {offline ? 'Waiting for backend…' : 'Drafting spec…'}
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
          <View style={styles.confRow}>
            <Text style={styles.confLabel}>Confidence</Text>
            <Meter value={confidence} color={confidence >= 0.75 ? C.ready : C.needsyou} />
            <Text style={styles.confPct}>{Math.round(confidence * 100)}%</Text>
          </View>

          <View>
            <CapLabel>Goal</CapLabel>
            <Text style={styles.goal}>{(spec && spec.goal) || task.promptText}</Text>
          </View>

          {spec && Array.isArray(spec.assumptions) && spec.assumptions.length > 0 && (
            <View>
              <CapLabel style={{ marginBottom: 8 }}>I'm assuming</CapLabel>
              {spec.assumptions.map((a, i) => (
                <View key={i} style={styles.assum}>
                  <Text style={styles.assumTxt}>
                    {typeof a === 'string' ? a : a.statement}
                  </Text>
                  {typeof a === 'object' && a.reversible === false && (
                    <Text style={styles.irrev}>irreversible</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {spec && Array.isArray(spec.acceptance) && spec.acceptance.length > 0 && (
            <View>
              <CapLabel style={{ marginBottom: 6 }}>Done when</CapLabel>
              {spec.acceptance.map((a, i) => (
                <Text key={i} style={styles.accept}>
                  • {a}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.riskRow}>
            <CapLabel>Risk</CapLabel>
            <Dot status={riskStatus} size={9} />
            <Text style={styles.riskTxt}>{risk} · branch only</Text>
          </View>

          <View style={{ height: 8 }} />
          <Button
            title={acting === 'go' ? 'Starting…' : 'Looks right — go'}
            onPress={go}
            disabled={!!acting}
          />
          <Button
            title="Hold"
            variant="sec"
            onPress={hold}
            disabled={!!acting}
            style={{ marginTop: 10 }}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { color: C.text2, fontSize: 13 },
  body: { paddingHorizontal: 20, paddingBottom: 28, gap: 18 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confLabel: { fontSize: 12, color: C.text2 },
  confPct: { fontSize: 12, color: C.text2 },
  goal: { fontSize: 16, fontWeight: '600', color: C.text, lineHeight: 22, marginTop: 6 },
  assum: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  assumTxt: { flex: 1, fontSize: 13, color: C.text },
  irrev: { fontSize: 11, color: C.blocked, fontWeight: '600' },
  accept: { fontSize: 14, color: C.text2, lineHeight: 22 },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskTxt: { fontSize: 13, color: C.text2 },
});
