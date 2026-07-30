import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, statusOf, stateLabel } from '../../src/theme';
import { StatusBarFaux, BackRow, openUrl, prNumber } from '../../src/components';
import { CapLabel, Card, Button, Dot, OfflineBanner } from '../../src/ui';
import { PressableScale } from '../../src/anim';
import { usePoll } from '../../src/hooks';
import { Markdown } from '../../src/markdown';
import { DiffView, ChecksRow, ReviewCard } from '../../src/diff';
import { api } from '../../src/api';

// Optional on-device voice (same defensive load as the Capture screen).
let Speech = null;
try { Speech = require('expo-speech-recognition').ExpoSpeechRecognitionModule; } catch (_) { Speech = null; }
const VOICE_OK = !!Speech && Platform.OS !== 'web';

function filesSummary(task) {
  const files = Array.isArray(task.files) ? task.files : [];
  if (!files.length) return null;
  const add = files.reduce((n, f) => n + (f.add || 0), 0);
  const del = files.reduce((n, f) => n + (f.del || 0), 0);
  return `${files.length} file${files.length === 1 ? '' : 's'} · +${add} −${del}`;
}

export default function TaskDetail() {
  const { id } = useLocalSearchParams();
  const { data, offline } = usePoll(() => api.task(id), 2000, [id]);
  const task = data && data.task;

  const status = task ? statusOf(task.state) : 'queued';
  const spec = task && task.spec;
  const progress = (task && task.progress) || [];
  const pr = task && task.prUrl;

  const [reviseOpen, setReviseOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState(null);
  const [listening, setListening] = useState(false);
  const baseComment = useRef('');

  useEffect(() => {
    if (!VOICE_OK) return;
    const subs = [];
    try {
      subs.push(Speech.addListener('result', (e) => {
        const phrase = (e.results && e.results[0] && e.results[0].transcript) || '';
        if (phrase) setComment((baseComment.current ? baseComment.current + ' ' : '') + phrase);
      }));
      subs.push(Speech.addListener('error', () => setListening(false)));
      subs.push(Speech.addListener('end', () => setListening(false)));
    } catch (_) {}
    return () => subs.forEach((s) => { try { s.remove(); } catch (_) {} });
  }, []);

  async function toggleVoice() {
    if (!VOICE_OK) return;
    if (listening) { try { Speech.stop(); } catch (_) {} setListening(false); return; }
    try {
      const perm = await Speech.requestPermissionsAsync();
      if (!perm || !perm.granted) return;
      baseComment.current = comment.trim();
      setListening(true);
      Speech.start({ lang: 'en-US', interimResults: true, continuous: false });
    } catch (_) { setListening(false); }
  }

  async function doMerge() {
    setBusy(true); setActionErr(null);
    try { await api.mergeTask(id); } catch (e) { setActionErr(`Merge failed: ${(e.message || '').slice(0, 90)}`); }
    finally { setBusy(false); }
  }
  async function doRevise() {
    const c = comment.trim();
    if (!c) return;
    setBusy(true); setActionErr(null);
    try { await api.reviseTask(id, c); setComment(''); setReviseOpen(false); }
    catch (e) { setActionErr(`Couldn't send: ${(e.message || '').slice(0, 90)}`); }
    finally { setBusy(false); }
  }

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
                <Text style={[styles.checkLabel, { color: C.ready }]}>Answer</Text>
                <Markdown text={task.answer} />
              </Card>
            ) : null}

            {task.answer ? null : task.summary ? (
              <View>
                <CapLabel style={{ marginBottom: 6 }}>Summary</CapLabel>
                <Markdown text={task.summary} />
              </View>
            ) : spec && spec.goal ? (
              <View>
                <CapLabel style={{ marginBottom: 6 }}>Goal</CapLabel>
                <Text style={styles.summary}>{spec.goal}</Text>
              </View>
            ) : null}

            {(task.review || task.checks || (Array.isArray(task.files) && task.files.length > 0) || task.diff) && (
              <View>
                <View style={styles.changesHead}>
                  <CapLabel>Changes</CapLabel>
                  {filesSummary(task) ? <Text style={styles.changesSummary}>{filesSummary(task)}</Text> : null}
                </View>
                <ReviewCard review={task.review} />
                <ChecksRow checks={task.checks} />
                <DiffView diff={task.diff} truncated={task.diffTruncated} />
              </View>
            )}

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

            {task.state === 'ANSWERED' ? null : task.state === 'MERGED' ? (
              <View style={styles.mergedBadge}>
                <Feather name="git-merge" size={16} color={C.ready} />
                <Text style={styles.mergedTxt}>Merged</Text>
                {pr ? (
                  <Pressable onPress={() => openUrl(pr)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                    <Text style={styles.openPrLink}>View PR ↗</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (status === 'ready' && pr) ? (
              <>
                <Button
                  title={task.state === 'MERGING' ? 'Merging…' : 'Approve & merge'}
                  onPress={doMerge}
                  disabled={busy || task.state === 'MERGING'}
                />
                <Button
                  title="Request changes"
                  variant="sec"
                  style={{ marginTop: 10 }}
                  onPress={() => setReviseOpen((o) => !o)}
                  disabled={busy || task.state === 'MERGING'}
                />
                {reviseOpen && (
                  <View style={styles.reviseBox}>
                    <View style={styles.reviseInputRow}>
                      <TextInput
                        style={styles.reviseInput}
                        placeholder="What should change? e.g. “rename it to authGuard and add a test”"
                        placeholderTextColor={C.muted}
                        value={comment}
                        onChangeText={setComment}
                        multiline
                      />
                      {VOICE_OK && (
                        <PressableScale onPress={toggleVoice} scaleTo={0.9} style={[styles.micBtn, listening && styles.micBtnOn]}>
                          <Feather name={listening ? 'square' : 'mic'} size={16} color={listening ? '#fff' : C.accent} />
                        </PressableScale>
                      )}
                    </View>
                    <Button
                      title={busy ? 'Sending…' : 'Send to agent'}
                      small
                      onPress={doRevise}
                      disabled={busy || !comment.trim()}
                      style={{ marginTop: 10 }}
                    />
                    <Text style={styles.reviseHint}>The agent will revise this PR and push an update.</Text>
                  </View>
                )}
                <Pressable onPress={() => openUrl(pr)} hitSlop={8} style={{ marginTop: 12, alignSelf: 'center' }}>
                  <Text style={styles.openPrLink}>Open PR{prNumber(pr) ? ` #${prNumber(pr)}` : ''} on GitHub ↗</Text>
                </Pressable>
                {actionErr ? <Text style={styles.actionErr}>{actionErr}</Text> : null}
              </>
            ) : pr ? (
              <Button title={`Open PR${prNumber(pr) ? ` #${prNumber(pr)}` : ''} ↗`} onPress={() => openUrl(pr)} />
            ) : (
              <Button title="Open PR — pending" disabled onPress={() => {}} />
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
  changesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  changesSummary: { fontSize: 12, color: C.text2, fontWeight: '600' },
  mergedBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(48,209,88,0.12)', borderWidth: 1, borderColor: 'rgba(48,209,88,0.4)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  mergedTxt: { fontSize: 14, fontWeight: '800', color: C.ready },
  openPrLink: { fontSize: 13, color: C.accent, fontWeight: '600' },
  reviseBox: { marginTop: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  reviseInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  reviseInput: { flex: 1, minHeight: 44, maxHeight: 120, color: C.text, fontSize: 14, lineHeight: 20, paddingTop: 6, outlineStyle: 'none' },
  micBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  micBtnOn: { backgroundColor: C.blocked },
  reviseHint: { fontSize: 11.5, color: C.muted, marginTop: 8 },
  actionErr: { fontSize: 12.5, color: C.blocked, textAlign: 'center', marginTop: 10 },
  progRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 2 },
  progGlyph: { fontSize: 13.5, width: 14 },
  progTxt: { flex: 1, fontSize: 13.5, color: C.text2, lineHeight: 21 },
});
