// Higher-level shared components: fake phone status bar, context bar, task row, back row.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { C } from './theme';
import { Dot } from './ui';
import { statusOf, stateLabel } from './theme';

export function StatusBarFaux() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[sb.wrap, { paddingTop: Math.max(insets.top, 8) }]}>
      <Text style={sb.time}>9:41</Text>
      <View style={sb.right}>
        <Text style={sb.sig}>●●●</Text>
        <View style={sb.batt} />
      </View>
    </View>
  );
}

export function ContextBar({ context, offline }) {
  const repo = context?.repo || 'No repo selected';
  const branch = context?.workBranch || context?.baseBranch || 'no branch';
  return (
    <View style={ctx.wrap}>
      <View style={ctx.repoRow}>
        <Text style={ctx.repo} numberOfLines={1}>
          {repo}
        </Text>
        <Pressable onPress={() => router.push('/repo-picker')}>
          <Text style={ctx.switch}>switch</Text>
        </Pressable>
      </View>
      <View style={ctx.branchRow}>
        <Pressable onPress={() => router.push('/branch-picker')}>
          <Text style={ctx.branch}>⎇ {branch}</Text>
        </Pressable>
        <View style={ctx.pill}>
          <Text style={ctx.pillTxt}>DRAFT ONLY</Text>
        </View>
      </View>
    </View>
  );
}

export function TaskRow({ task, onPress, showSub = true }) {
  const status = statusOf(task.state);
  const pct = latestPct(task);
  const running = status === 'running';
  const sub = subFor(task);
  return (
    <Pressable style={tr.row} onPress={onPress}>
      <Dot status={status} style={{ marginTop: 5 }} />
      <View style={{ flex: 1 }}>
        <Text style={tr.title} numberOfLines={2}>
          {task.promptText || '(untitled task)'}
        </Text>
        {showSub && !!sub && (
          <Text style={tr.sub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {running && pct != null && <Text style={tr.prog}>{pct}%</Text>}
    </Pressable>
  );
}

function latestPct(task) {
  const p = task.progress;
  if (Array.isArray(p) && p.length) {
    const last = p[p.length - 1];
    if (typeof last.pct === 'number') return Math.round(last.pct);
  }
  return null;
}

function subFor(task) {
  const status = statusOf(task.state);
  if (status === 'ready' && task.prUrl) {
    const num = prNumber(task.prUrl);
    return num ? `PR #${num} ready` : 'PR ready';
  }
  if (status === 'needsyou') {
    const last = lastMessage(task);
    return last ? `"${last}"` : stateLabel(task.state);
  }
  if (status === 'blocked') {
    const last = lastMessage(task);
    return last ? `blocked · ${last}` : 'blocked';
  }
  if (status === 'running') return null;
  return stateLabel(task.state);
}

export function lastMessage(task) {
  const p = task.progress;
  if (Array.isArray(p) && p.length) {
    const last = p[p.length - 1];
    if (last.message) return last.message;
  }
  return null;
}

export function prNumber(url) {
  if (!url) return null;
  const m = String(url).match(/\/pull\/(\d+)/);
  return m ? m[1] : null;
}

export function openUrl(url) {
  if (!url) return;
  Linking.openURL(url).catch(() => {});
}

export function BackRow({ title, right, onBack }) {
  return (
    <View style={br.wrap}>
      {onBack !== false && (
        <Pressable onPress={onBack || (() => router.back())} hitSlop={10}>
          <Text style={br.x}>←</Text>
        </Pressable>
      )}
      <Text style={br.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

const sb = StyleSheet.create({
  wrap: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  time: { color: C.text, fontSize: 13, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sig: { color: C.text, fontSize: 11, letterSpacing: 1 },
  batt: {
    width: 17,
    height: 11,
    borderWidth: 1.4,
    borderColor: C.text,
    borderRadius: 3,
    opacity: 0.9,
  },
});

const ctx = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 15,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  repoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repo: { flex: 1, fontSize: 16, fontWeight: '700', color: C.text },
  switch: { fontSize: 12, color: C.accent, fontWeight: '600' },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  branch: { fontSize: 12.5, color: C.text2 },
  pill: {
    backgroundColor: 'rgba(48,209,88,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  pillTxt: { fontSize: 10, fontWeight: '700', color: C.ready, letterSpacing: 0.3 },
});

const tr = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 11 },
  title: { fontSize: 14.5, color: C.text, fontWeight: '500' },
  sub: { fontSize: 12, color: C.muted, marginTop: 2 },
  prog: { fontSize: 11.5, color: C.running, fontWeight: '600' },
});

const br = StyleSheet.create({
  wrap: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  x: { color: C.text2, fontSize: 22 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: C.text },
});
