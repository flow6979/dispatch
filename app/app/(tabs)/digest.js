import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { C, statusOf } from '../../src/theme';
import { StatusBarFaux } from '../../src/components';
import { lastMessage } from '../../src/components';
import { Card, Dot, OfflineBanner } from '../../src/ui';
import { useTasks } from '../../src/hooks';

export default function Digest() {
  const { tasks, offline } = useTasks();

  const needs = tasks.filter((t) => statusOf(t.state) === 'needsyou');
  const ready = tasks.filter((t) => statusOf(t.state) === 'ready');
  const blocked = tasks.filter((t) => statusOf(t.state) === 'blocked');

  const repos = new Set(tasks.map((t) => t.repo).filter(Boolean));
  // Real spend: sum of actual tokens + dollar cost reported by the runner.
  const spent = tasks.reduce((sum, t) => sum + (t.tokensUsed || 0), 0);
  const spentUsd = tasks.reduce((sum, t) => sum + (t.costUsd || 0), 0);

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Good morning ☕</Text>
        <Text style={styles.sub}>
          {tasks.length === 0
            ? offline
              ? 'Waiting for backend…'
              : 'Nothing captured yet.'
            : `${tasks.length} task${tasks.length === 1 ? '' : 's'} across ${
                repos.size || 1
              } repo${repos.size === 1 ? '' : 's'}`}
        </Text>

        <Card style={[styles.card, { borderColor: 'rgba(245,166,35,0.35)' }]}>
          <View style={styles.row}>
            <Dot status="needsyou" />
            <Text style={styles.cardTitle}>
              {needs.length} need{needs.length === 1 ? 's' : ''} a decision
            </Text>
          </View>
          <Text style={styles.cardBody}>
            {needs.length
              ? `${trim(needs[0].promptText)} — pick before it proceeds.`
              : 'No decisions waiting on you.'}
          </Text>
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Dot status="ready" />
            <Text style={styles.cardTitle}>
              {ready.length} ready to review
            </Text>
          </View>
          <Text style={styles.cardBody}>
            {ready.length
              ? `Review "${trim(ready[0].promptText)}" first.`
              : 'Nothing to review yet.'}
          </Text>
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Dot status="blocked" />
            <Text style={styles.cardTitle}>
              {blocked.length} blocked
            </Text>
          </View>
          <Text style={styles.cardBody}>
            {blocked.length
              ? `${trim(blocked[0].promptText)} — ${
                  lastMessage(blocked[0]) || 'needs a hand'
                }.`
              : 'Nothing blocked.'}
          </Text>
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerTxt}>spent so far</Text>
          <Text style={styles.footerTxt}>
            ~{Math.round(spent / 1000)}k tokens{spentUsd ? ` · $${spentUsd.toFixed(2)}` : ''}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function trim(s) {
  s = s || 'task';
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { padding: 20, paddingTop: 26, gap: 14 },
  h1: { fontSize: 22, fontWeight: '800', color: C.text },
  sub: { fontSize: 13.5, color: C.text2, marginTop: -6, marginBottom: 4 },
  card: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  cardBody: { fontSize: 13, color: C.text2, marginTop: 8, lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 14,
    marginTop: 4,
  },
  footerTxt: { fontSize: 12.5, color: C.muted },
});
