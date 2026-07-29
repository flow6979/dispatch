import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { C, statusOf, stateLabel } from '../../src/theme';
import { StatusBarFaux, BackRow, openUrl, prNumber } from '../../src/components';
import { CapLabel, Card, Button, Dot, OfflineBanner } from '../../src/ui';
import { usePoll } from '../../src/hooks';
import { api } from '../../src/api';

export default function TaskDetail() {
  const { id } = useLocalSearchParams();
  const { data, offline } = usePoll(() => api.task(id), 2000, [id]);
  const task = data && data.task;

  const status = task ? statusOf(task.state) : 'queued';
  const spec = task && task.spec;
  const progress = (task && task.progress) || [];
  const pr = task && task.prUrl;

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow
        title={task ? truncate(task.promptText) : 'Task'}
        right={task ? <Dot status={status} /> : null}
      />
      {!task ? (
        <View style={styles.loading}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.loadingTxt}>
            {offline ? 'Waiting for backend…' : 'Loading…'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.repoLine}>
            <Text style={styles.repoTxt}>
              {task.repo || 'no repo'} · ⎇ {task.workBranch || task.baseBranch || 'no branch'}
            </Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
            {status === 'needsyou' && (
              <Card style={{ borderColor: 'rgba(245,166,35,0.4)' }}>
                <Text style={[styles.checkLabel, { color: C.needsyou }]}>
                  ⚠ Needs you
                </Text>
                <Text style={styles.checkTxt}>
                  {lastMsg(progress) || 'This task needs your input to continue.'}
                </Text>
              </Card>
            )}
            {status === 'blocked' && (
              <Card style={{ borderColor: 'rgba(255,69,58,0.4)' }}>
                <Text style={[styles.checkLabel, { color: C.blocked }]}>✕ Blocked</Text>
                <Text style={styles.checkTxt}>
                  {lastMsg(progress) || 'Blocked — needs a hand.'}
                </Text>
              </Card>
            )}

            <View style={styles.statePill}>
              <Dot status={status} size={9} />
              <Text style={styles.statePillTxt}>{stateLabel(task.state)}</Text>
            </View>

            <View style={styles.tokenRow}>
              <Text style={styles.tokenUsed}>{fmtTokens(task.tokensUsed)}</Text>
              <Text style={styles.tokenLabel}>tokens</Text>
              {task.costUsd ? <Text style={styles.tokenCost}>{fmtCost(task.costUsd)}</Text> : null}
            </View>
            <Text style={styles.tokenSub}>
              this task{task.budgetTokens ? ` · budget ${fmtTokens(task.budgetTokens)} tokens` : ''}
            </Text>

            {task.answer ? (
              <Card style={{ borderColor: 'rgba(48,209,88,0.35)' }}>
                <Text style={[styles.checkLabel, { color: C.ready }]}>💬 Answer</Text>
                <Text style={styles.answerTxt}>{task.answer}</Text>
              </Card>
            ) : null}

            {task.answer ? null : task.summary ? (
              <View>
                <CapLabel style={{ marginBottom: 6 }}>Summary</CapLabel>
                <Text style={styles.summary}>{task.summary}</Text>
              </View>
            ) : spec && spec.goal ? (
              <View>
                <CapLabel style={{ marginBottom: 6 }}>Goal</CapLabel>
                <Text style={styles.summary}>{spec.goal}</Text>
              </View>
            ) : null}

            {progress.length > 0 && (
              <View>
                <CapLabel style={{ marginBottom: 8 }}>Progress</CapLabel>
                {progress.map((p, i) => {
                  const done = i < progress.length - 1;
                  const running = i === progress.length - 1 && status === 'running';
                  return (
                    <View key={i} style={styles.progRow}>
                      <Text
                        style={[
                          styles.progGlyph,
                          { color: running ? C.running : done ? C.ready : C.text2 },
                        ]}
                      >
                        {running ? '●' : done ? '✓' : '•'}
                      </Text>
                      <Text style={styles.progTxt}>
                        {p.message || stateLabel(p.state)}
                        {typeof p.pct === 'number' ? ` · ${Math.round(p.pct)}%` : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ flex: 1, minHeight: 12 }} />

            {task.state === 'ANSWERED' ? null : pr ? (
              <Button
                title={`Open PR${prNumber(pr) ? ` #${prNumber(pr)}` : ''} ↗`}
                onPress={() => openUrl(pr)}
              />
            ) : (
              <Button
                title="Open PR — pending"
                disabled
                onPress={() => {}}
              />
            )}
            {status === 'needsyou' && task.state === 'SPEC_DRAFTED' && (
              <Button
                title="Review spec"
                variant="sec"
                style={{ marginTop: 10 }}
                onPress={() => router.push(`/spec/${task.id}`)}
              />
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function truncate(s) {
  s = s || 'Task';
  return s.length > 28 ? s.slice(0, 26) + '…' : s;
}
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  return String(v);
}
function fmtCost(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  return v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
}
function lastMsg(progress) {
  if (Array.isArray(progress) && progress.length) return progress[progress.length - 1].message;
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { color: C.text2, fontSize: 13 },
  repoLine: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 4 },
  repoTxt: { fontSize: 12.5, color: C.text2 },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 18, flexGrow: 1 },
  checkLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 7, textTransform: 'uppercase' },
  checkTxt: { fontSize: 14, color: C.text, lineHeight: 21 },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statePillTxt: { fontSize: 13, color: C.text2, textTransform: 'capitalize' },
  tokenRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  tokenUsed: { fontSize: 22, fontWeight: '800', color: C.text },
  tokenLabel: { fontSize: 12.5, color: C.muted },
  tokenCost: { fontSize: 16, fontWeight: '700', color: C.ready, marginLeft: 4 },
  tokenSub: { fontSize: 12, color: C.muted, marginTop: -8 },
  summary: { fontSize: 13.5, color: C.text2, lineHeight: 21 },
  answerTxt: { fontSize: 14, color: C.text, lineHeight: 22 },
  progRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 2 },
  progGlyph: { fontSize: 13.5, width: 14 },
  progTxt: { flex: 1, fontSize: 13.5, color: C.text2, lineHeight: 21 },
});
