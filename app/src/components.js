// Higher-level shared components: fake phone status bar, context bar, task row, back row.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { C } from './theme';
import { Dot } from './ui';
import { statusOf, stateLabel } from './theme';
import { Feather } from '@expo/vector-icons';
import { PressableScale, FadeIn } from './anim';

// On a real device the OS already draws the status bar, so we must NOT render a
// second fake one (that showed a frozen "9:41 ●●● ▢" bar). Here we just reserve
// the safe-area inset so content clears the notch/status bar. The decorative
// mockup bar is kept for web only, where there is no OS status bar.
export function StatusBarFaux() {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'web') {
    return <View style={{ height: Math.max(insets.top, 0), backgroundColor: C.canvas }} />;
  }
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
  const hasRepo = !!context?.repo;
  const branch = context?.workBranch || context?.baseBranch || 'no branch';
  const shortRepo = repo.split('/').pop();
  return (
    <View style={ctx.wrap}>
      <View style={ctx.iconBox}>
        <Feather name="github" size={17} color={hasRepo ? C.text : C.muted} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[ctx.repo, !hasRepo && { color: C.text2 }]} numberOfLines={1}>
          {hasRepo ? shortRepo : 'No repo selected'}
        </Text>
        <View style={ctx.metaRow}>
          <Pressable onPress={() => router.push('/branch-picker')} style={ctx.branchBtn} hitSlop={6}>
            <Feather name="git-branch" size={11} color={C.text2} style={{ marginRight: 4 }} />
            <Text style={ctx.branch} numberOfLines={1}>{branch}</Text>
          </Pressable>
          <View style={ctx.dot} />
          <Feather name="shield" size={10} color={C.ready} style={{ marginRight: 3 }} />
          <Text style={ctx.draft}>Draft only</Text>
        </View>
      </View>
      <PressableScale onPress={() => router.push('/repo-picker')} style={ctx.changeBtn} scaleTo={0.93}>
        <Feather name="repeat" size={12} color={C.accent} style={{ marginRight: 5 }} />
        <Text style={ctx.change}>{hasRepo ? 'Change' : 'Select'}</Text>
      </PressableScale>
    </View>
  );
}

export function TaskRow({ task, onPress, showSub = true, index = 0 }) {
  const status = statusOf(task.state);
  const pct = latestPct(task);
  const running = status === 'running';
  const sub = subFor(task);
  return (
    <FadeIn delay={Math.min(index, 8) * 45}>
      <PressableScale style={tr.row} onPress={onPress} scaleTo={0.985}>
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
        <Feather name="chevron-right" size={18} color={C.muted} style={{ marginTop: 2, marginLeft: 2 }} />
      </PressableScale>
    </FadeIn>
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

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  return String(v);
}

function fmtCost(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  return v < 0.01 ? ' · <$0.01' : ` · $${v.toFixed(2)}`;
}

function subFor(task) {
  const status = statusOf(task.state);
  const tok = (task.tokensUsed ? ` · ${fmtTokens(task.tokensUsed)} tokens` : '') + fmtCost(task.costUsd);
  if (task.state === 'ANSWERED') return 'answered' + tok;
  if (status === 'ready' && task.prUrl) {
    const num = prNumber(task.prUrl);
    return (num ? `PR #${num} ready` : 'PR ready') + tok;
  }
  if (status === 'needsyou') {
    const last = lastMessage(task);
    return last ? `"${last}"` : stateLabel(task.state);
  }
  if (status === 'blocked') {
    const last = lastMessage(task);
    return (last ? `blocked · ${last}` : 'blocked') + tok;
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 15,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repo: { fontSize: 16, fontWeight: '700', color: C.text, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  branchBtn: { flexDirection: 'row', alignItems: 'center', maxWidth: 150 },
  branch: { fontSize: 12.5, color: C.text2 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.muted, marginHorizontal: 8 },
  draft: { fontSize: 12, color: C.muted, fontWeight: '500' },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.accentSoft,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 13,
  },
  change: { fontSize: 12.5, color: C.accent, fontWeight: '700' },
});

const tr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  title: { fontSize: 15, color: C.text, fontWeight: '600', lineHeight: 20 },
  sub: { fontSize: 12.5, color: C.muted, marginTop: 3 },
  prog: { fontSize: 12, color: C.running, fontWeight: '700', marginTop: 2 },
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
