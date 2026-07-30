// Renders a unified git diff as a phone-friendly, file-by-file review view:
// collapsible files with +/- line stats and colored add/delete rows. Plus a
// compact checks (tests) summary. No native deps — pure Text/View.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C } from './theme';

function parseDiff(diff) {
  const files = [];
  let cur = null;
  const push = (path) => { cur = { path, hunks: [], add: 0, del: 0 }; files.push(cur); };
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('diff --git')) {
      const m = line.match(/ b\/(.+)$/);
      push(m ? m[1] : 'file');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const m = line.match(/^\+\+\+ b\/(.+)$/);
      if (cur && m) cur.path = m[1];
      continue;
    }
    if (
      line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('new file') ||
      line.startsWith('deleted file') || line.startsWith('old mode') || line.startsWith('new mode') ||
      line.startsWith('similarity ') || line.startsWith('rename ') || line.startsWith('Binary ')
    ) continue;
    if (line.startsWith('@@')) {
      if (!cur) push('changes');
      const clean = line.replace(/@@\s*(.*?)\s*@@.*/, '@@ $1 @@');
      cur.hunks.push({ header: clean, lines: [] });
      continue;
    }
    if (!cur || !cur.hunks.length) continue;
    const h = cur.hunks[cur.hunks.length - 1];
    let type = 'ctx';
    if (line.startsWith('+')) { type = 'add'; cur.add++; }
    else if (line.startsWith('-')) { type = 'del'; cur.del++; }
    else if (line.startsWith('\\')) { type = 'meta'; }
    h.lines.push({ type, text: line });
  }
  return files;
}

function FileBlock({ file, index }) {
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  const [open, setOpen] = useState(index === 0 || total <= 120);
  return (
    <View style={s.file}>
      <Pressable style={s.fileHead} onPress={() => setOpen((o) => !o)}>
        <Feather name={open ? 'chevron-down' : 'chevron-right'} size={15} color={C.muted} />
        <Feather name="file-text" size={13} color={C.text2} style={{ marginLeft: 2 }} />
        <Text style={s.filePath} numberOfLines={1} ellipsizeMode="middle">{file.path}</Text>
        {file.add > 0 && <Text style={s.add}>+{file.add}</Text>}
        {file.del > 0 && <Text style={s.del}>−{file.del}</Text>}
      </Pressable>
      {open && (
        <View style={s.body}>
          {file.hunks.map((h, hi) => (
            <View key={hi}>
              <Text style={s.hunk}>{h.header}</Text>
              {h.lines.map((ln, li) => (
                <View
                  key={li}
                  style={[s.row, ln.type === 'add' && s.rowAdd, ln.type === 'del' && s.rowDel]}
                >
                  <Text style={s.sign}>{ln.type === 'add' ? '+' : ln.type === 'del' ? '−' : ' '}</Text>
                  <Text
                    style={[s.code, ln.type === 'add' && s.codeAdd, ln.type === 'del' && s.codeDel]}
                  >
                    {ln.text.replace(/^[+\- ]/, '') || ' '}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function DiffView({ diff, truncated }) {
  const parsed = React.useMemo(() => parseDiff(diff), [diff]);
  if (!parsed.length) {
    return <Text style={s.empty}>No inline diff available — open the PR to view the change.</Text>;
  }
  return (
    <View>
      {parsed.map((f, i) => <FileBlock key={i} file={f} index={i} />)}
      {truncated && (
        <Text style={s.trunc}>Diff truncated for size — open the PR for the full change.</Text>
      )}
    </View>
  );
}

export function ReviewCard({ review }) {
  if (!review || (!review.summary && !(review.concerns && review.concerns.length))) return null;
  const risk = review.risk || 'low';
  const color = risk === 'high' ? C.blocked : risk === 'medium' ? C.needsyou : C.ready;
  const icon = risk === 'high' ? 'alert-triangle' : risk === 'medium' ? 'alert-circle' : 'shield';
  const dot = (sev) => (sev === 'high' ? C.blocked : sev === 'medium' ? C.needsyou : C.muted);
  return (
    <View style={[s.review, { borderColor: `${color}44` }]}>
      <View style={s.reviewHead}>
        <Feather name={icon} size={15} color={color} />
        <Text style={[s.reviewRisk, { color }]}>{risk} risk</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.reviewTag}>self-review</Text>
      </View>
      {review.summary ? <Text style={s.reviewSummary}>{review.summary}</Text> : null}
      {Array.isArray(review.concerns) && review.concerns.map((c, i) => (
        <View key={i} style={s.concern}>
          <View style={[s.concernDot, { backgroundColor: dot(c.severity) }]} />
          <Text style={s.concernTxt}>{c.note}</Text>
        </View>
      ))}
    </View>
  );
}

export function ChecksRow({ checks }) {
  const t = checks && checks.tests;
  if (!t) return null;
  const state = !t.ran ? 'none' : t.passed ? 'pass' : 'fail';
  const color = state === 'pass' ? C.ready : state === 'fail' ? C.blocked : C.muted;
  const icon = state === 'pass' ? 'check-circle' : state === 'fail' ? 'x-circle' : 'minus-circle';
  const label = state === 'pass' ? 'Tests passed' : state === 'fail' ? 'Tests failed' : 'No tests detected';
  return (
    <View style={[s.checks, { borderColor: `${color}55` }]}>
      <Feather name={icon} size={15} color={color} />
      <Text style={[s.checksTxt, { color }]}>{label}</Text>
      {t.command ? <Text style={s.checksCmd} numberOfLines={1}>{t.command}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  file: { borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: '#0D1017' },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: C.surface2 },
  filePath: { flex: 1, fontSize: 12.5, color: C.text, fontWeight: '600' },
  add: { fontSize: 12, color: C.ready, fontWeight: '700' },
  del: { fontSize: 12, color: C.blocked, fontWeight: '700' },
  body: { paddingVertical: 4 },
  hunk: { fontFamily: 'monospace', fontSize: 11, color: C.muted, backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 12, paddingVertical: 3 },
  row: { flexDirection: 'row', paddingHorizontal: 8, alignItems: 'flex-start' },
  rowAdd: { backgroundColor: 'rgba(48,209,88,0.10)' },
  rowDel: { backgroundColor: 'rgba(255,69,58,0.10)' },
  sign: { fontFamily: 'monospace', fontSize: 11.5, lineHeight: 18, color: C.muted, width: 12, textAlign: 'center' },
  code: { flex: 1, fontFamily: 'monospace', fontSize: 11.5, lineHeight: 18, color: C.text2 },
  codeAdd: { color: '#7EE787' },
  codeDel: { color: '#FFA198' },
  trunc: { fontSize: 12, color: C.muted, fontStyle: 'italic', marginTop: 2, marginBottom: 4 },
  empty: { fontSize: 13, color: C.muted, lineHeight: 20 },
  checks: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12, backgroundColor: C.surface },
  checksTxt: { fontSize: 13, fontWeight: '700' },
  checksCmd: { flex: 1, fontFamily: 'monospace', fontSize: 11, color: C.muted, textAlign: 'right' },
  review: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12, backgroundColor: C.surface },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  reviewRisk: { fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  reviewTag: { fontSize: 10.5, fontWeight: '700', color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  reviewSummary: { fontSize: 13.5, color: C.text2, lineHeight: 20, marginBottom: 4 },
  concern: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  concernDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  concernTxt: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
});
