import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { C, statusOf } from '../../src/theme';
import { StatusBarFaux } from '../../src/components';
import { OfflineBanner } from '../../src/ui';
import { FadeIn } from '../../src/anim';
import { useTasks } from '../../src/hooks';

// ---- helpers ----
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return ['Working late', 'moon'];
  if (h < 12) return ['Good morning', 'sunrise'];
  if (h < 17) return ['Good afternoon', 'sun'];
  if (h < 21) return ['Good evening', 'sunset'];
  return ['Good night', 'moon'];
}
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}
function fmtCost(n) {
  const v = Number(n) || 0;
  return v < 0.01 ? '$0' : `$${v.toFixed(2)}`;
}

const HEAT = ['#171a21', 'rgba(48,209,88,0.30)', 'rgba(48,209,88,0.52)', 'rgba(48,209,88,0.74)', '#30D158'];
function heatLevel(cost) {
  if (cost <= 0) return 0;
  if (cost < 0.1) return 1;
  if (cost < 0.5) return 2;
  if (cost < 1.5) return 3;
  return 4;
}
const DAY_MS = 86400000;

// ---- small building blocks ----
function Section({ icon, title, children, right }) {
  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.secHead}>
        <Feather name={icon} size={13} color={C.muted} />
        <Text style={styles.secTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

function Heatmap({ byDay }) {
  const weeks = 13;
  const today = new Date();
  const start = new Date(today.getTime() - (today.getDay() + (weeks - 1) * 7) * DAY_MS);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(start.getTime() + (w * 7 + r) * DAY_MS);
      const future = d > today;
      const b = byDay[dateKey(d)];
      col.push({ future, level: future ? 0 : heatLevel(b ? b.cost : 0), cost: b ? b.cost : 0 });
    }
    cols.push(col);
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {cols.map((col, i) => (
          <View key={i} style={{ gap: 3 }}>
            {col.map((cell, j) => (
              <View
                key={j}
                style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: cell.future ? 'transparent' : HEAT[cell.level] }}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.legendRow}>
        <Text style={styles.legendTxt}>Less</Text>
        {HEAT.map((c, i) => <View key={i} style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: c }} />)}
        <Text style={styles.legendTxt}>More</Text>
      </View>
    </View>
  );
}

function WeekBars({ byDay }) {
  const today = new Date();
  const days = [];
  let max = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const b = byDay[dateKey(d)];
    const cost = b ? b.cost : 0;
    max = Math.max(max, cost);
    days.push({ d, cost });
  }
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <View style={styles.weekWrap}>
      {days.map((x, i) => (
        <View key={i} style={styles.weekCol}>
          <View style={styles.weekBarTrack}>
            <LinearGradient
              colors={['#5AA0FF', '#3B82F6']}
              style={[styles.weekBar, { height: `${max > 0 ? Math.max(6, (x.cost / max) * 100) : 3}%` }]}
            />
          </View>
          <Text style={styles.weekLbl}>{L[x.d.getDay()]}</Text>
        </View>
      ))}
    </View>
  );
}

function OutcomeBar({ buckets, total }) {
  const segs = [
    { key: 'ready', color: C.ready, label: 'Done', n: buckets.ready },
    { key: 'running', color: C.running, label: 'Running', n: buckets.running },
    { key: 'needsyou', color: C.needsyou, label: 'Needs you', n: buckets.needsyou },
    { key: 'blocked', color: C.blocked, label: 'Blocked', n: buckets.blocked },
    { key: 'queued', color: C.muted, label: 'Queued', n: buckets.queued },
  ].filter((s) => s.n > 0);
  return (
    <View>
      <View style={styles.stackBar}>
        {segs.map((s) => (
          <View key={s.key} style={{ flex: s.n, backgroundColor: s.color }} />
        ))}
        {total === 0 && <View style={{ flex: 1, backgroundColor: C.surface2 }} />}
      </View>
      <View style={styles.legendWrap}>
        {segs.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendItemTxt}>{s.label} {s.n}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function Digest() {
  const { tasks, offline } = useTasks();

  const m = useMemo(() => {
    const byDay = {};
    let totalCost = 0, totalTokens = 0, weekCost = 0, weekTokens = 0;
    const buckets = { ready: 0, running: 0, needsyou: 0, blocked: 0, queued: 0 };
    const repoAgg = {};
    let chat = 0, build = 0, biggest = null;
    const weekAgo = Date.now() - 7 * DAY_MS;
    tasks.forEach((t) => {
      const cost = t.costUsd || 0, tok = t.tokensUsed || 0;
      totalCost += cost; totalTokens += tok;
      if (t.createdAt) {
        const k = dateKey(new Date(t.createdAt));
        const b = byDay[k] || (byDay[k] = { cost: 0, tokens: 0, count: 0 });
        b.cost += cost; b.tokens += tok; b.count++;
        if (t.createdAt >= weekAgo) { weekCost += cost; weekTokens += tok; }
      }
      buckets[statusOf(t.state)] = (buckets[statusOf(t.state)] || 0) + 1;
      if (t.repo) { const r = repoAgg[t.repo] || (repoAgg[t.repo] = { cost: 0, count: 0 }); r.cost += cost; r.count++; }
      if (t.state === 'ANSWERED' || t.resolvedKind === 'chat') chat++; else if (t.prUrl || t.resolvedKind === 'task') build++;
      if (!biggest || cost > biggest.costUsd) biggest = t;
    });
    const terminal = buckets.ready + buckets.blocked;
    const topRepos = Object.entries(repoAgg).map(([repo, v]) => ({ repo, ...v })).sort((a, b) => b.cost - a.cost).slice(0, 4);
    const maxRepoCost = topRepos.reduce((mx, r) => Math.max(mx, r.cost), 0) || 1;
    return {
      byDay, totalCost, totalTokens, weekCost, weekTokens, buckets, topRepos, maxRepoCost,
      chat, build, biggest, count: tasks.length,
      success: terminal ? Math.round((buckets.ready / terminal) * 100) : null,
      avgCost: tasks.length ? totalCost / tasks.length : 0,
    };
  }, [tasks]);

  const [hello, ico] = greeting();

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <View style={styles.headRow}>
          <View>
            <Text style={styles.h1}>{hello}</Text>
            <Text style={styles.sub}>
              {m.count === 0
                ? offline ? 'Waiting for backend…' : 'No tasks yet — insights appear as you go.'
                : `${m.count} task${m.count === 1 ? '' : 's'} · ${fmtCost(m.totalCost)} · ${fmtTokens(m.totalTokens)} tokens all-time`}
            </Text>
          </View>
          <Feather name={ico} size={26} color={C.needsyou} />
        </View>

        {/* stat tiles */}
        <FadeIn delay={30}>
          <View style={styles.tiles}>
            <LinearGradient colors={['#5AA0FF', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.tile, styles.tilePrimary]}>
              <Text style={styles.tileBig}>{fmtCost(m.weekCost)}</Text>
              <Text style={styles.tileLblLight}>this week</Text>
            </LinearGradient>
            <View style={styles.tile}>
              <Text style={styles.tileBig}>{fmtTokens(m.weekTokens)}</Text>
              <Text style={styles.tileLbl}>tokens / wk</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileBig}>{m.success == null ? '—' : `${m.success}%`}</Text>
              <Text style={styles.tileLbl}>success</Text>
            </View>
          </View>
        </FadeIn>

        {/* heatmap */}
        <FadeIn delay={90}>
          <Section icon="grid" title="SPEND ACTIVITY" right={<Text style={styles.secRight}>{fmtCost(m.totalCost)} total</Text>}>
            <View style={styles.card}><Heatmap byDay={m.byDay} /></View>
          </Section>
        </FadeIn>

        {/* this week bars */}
        <FadeIn delay={150}>
          <Section icon="bar-chart-2" title="LAST 7 DAYS">
            <View style={styles.card}><WeekBars byDay={m.byDay} /></View>
          </Section>
        </FadeIn>

        {/* outcomes */}
        <FadeIn delay={210}>
          <Section icon="check-circle" title="TASK OUTCOMES">
            <View style={styles.card}><OutcomeBar buckets={m.buckets} total={m.count} /></View>
          </Section>
        </FadeIn>

        {/* mode split */}
        {(m.chat + m.build) > 0 && (
          <FadeIn delay={260}>
            <Section icon="git-pull-request" title="WHAT YOU ASK FOR">
              <View style={styles.card}>
                <View style={styles.stackBar}>
                  {m.build > 0 && <View style={{ flex: m.build, backgroundColor: C.accent }} />}
                  {m.chat > 0 && <View style={{ flex: m.chat, backgroundColor: C.needsyou }} />}
                </View>
                <View style={styles.legendWrap}>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.accent }]} /><Text style={styles.legendItemTxt}>🔨 Build {m.build}</Text></View>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.needsyou }]} /><Text style={styles.legendItemTxt}>💬 Ask {m.chat}</Text></View>
                </View>
              </View>
            </Section>
          </FadeIn>
        )}

        {/* top repos */}
        {m.topRepos.length > 0 && (
          <FadeIn delay={310}>
            <Section icon="folder" title="TOP REPOS BY SPEND">
              <View style={styles.card}>
                {m.topRepos.map((r) => (
                  <View key={r.repo} style={styles.repoRow}>
                    <Text style={styles.repoName} numberOfLines={1}>{r.repo.split('/').pop()}</Text>
                    <View style={styles.repoBarTrack}>
                      <View style={[styles.repoBar, { width: `${Math.max(6, (r.cost / m.maxRepoCost) * 100)}%` }]} />
                    </View>
                    <Text style={styles.repoCost}>{fmtCost(r.cost)}</Text>
                  </View>
                ))}
              </View>
            </Section>
          </FadeIn>
        )}

        {/* footer stat */}
        {m.count > 0 && (
          <Text style={styles.footer}>
            Avg {fmtCost(m.avgCost)}/task{m.biggest && m.biggest.costUsd ? ` · priciest: ${fmtCost(m.biggest.costUsd)} (${(m.biggest.promptText || '').slice(0, 24)}…)` : ''}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { padding: 20, paddingTop: 24, paddingBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { fontSize: 24, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: C.text2, marginTop: 4, maxWidth: 280 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 18 },
  tile: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'flex-start' },
  tilePrimary: { borderWidth: 0, boxShadow: '0 6px 18px rgba(59,130,246,0.35)' },
  tileBig: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  tileLbl: { fontSize: 11.5, color: C.muted, marginTop: 3, fontWeight: '600' },
  tileLblLight: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 3, fontWeight: '600' },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  secTitle: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 0.8 },
  secRight: { fontSize: 11.5, color: C.text2, fontWeight: '600' },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, justifyContent: 'flex-end' },
  legendTxt: { fontSize: 10.5, color: C.muted, marginHorizontal: 3 },
  weekWrap: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 110 },
  weekCol: { alignItems: 'center', flex: 1, gap: 6 },
  weekBarTrack: { width: 16, height: 88, backgroundColor: C.surface2, borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' },
  weekBar: { width: '100%', borderRadius: 8 },
  weekLbl: { fontSize: 10.5, color: C.muted, fontWeight: '600' },
  stackBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.surface2 },
  legendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendItemTxt: { fontSize: 12, color: C.text2, fontWeight: '500' },
  repoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  repoName: { width: 96, fontSize: 12.5, color: C.text, fontWeight: '600' },
  repoBarTrack: { flex: 1, height: 8, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  repoBar: { height: '100%', backgroundColor: C.accent, borderRadius: 4 },
  repoCost: { width: 48, textAlign: 'right', fontSize: 12, color: C.text2, fontWeight: '600' },
  footer: { fontSize: 11.5, color: C.muted, marginTop: 22, textAlign: 'center', lineHeight: 17 },
});
