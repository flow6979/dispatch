// A small, dependency-free Markdown renderer for RN. Claude's answers come back
// as Markdown (headings, **bold**, `code`, lists, tables, > quotes, links); this
// turns them into a clean, README/Confluence-style formatted view instead of raw
// text. Deliberately no native deps — it parses to React Native <Text>/<View>.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Linking } from 'react-native';
import { C } from './theme';

export function Markdown({ text, style }) {
  const blocks = React.useMemo(() => parseBlocks(String(text == null ? '' : text)), [text]);
  return <View style={style}>{blocks.map((b, i) => renderBlock(b, i, i === blocks.length - 1))}</View>;
}

// ---------------- block parsing ----------------
function isBlockStart(l) {
  return (
    /^```/.test(l) ||
    /^#{1,6}\s/.test(l) ||
    /^\s*>\s?/.test(l) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(l) ||
    /^\s*([-*_])\1\1[-*_\s]*$/.test(l)
  );
}

function splitRow(l) {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseBlocks(src) {
  const lines = src.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume closing fence
      blocks.push({ type: 'code', lang: fence[1] || '', text: buf.join('\n') });
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) { i++; continue; }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].replace(/\s*#+\s*$/, '').trim() }); i++; continue; }

    // horizontal rule
    if (/^\s*([-*_])\1\1[-*_\s]*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    // blockquote (consume consecutive)
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: buf.join(' ') });
      continue;
    }

    // table: header row + separator row of dashes
    if (line.includes('|') && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // list (unordered or ordered) — consume consecutive items
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        items.push({ ordered: /\d/.test(m[2]), indent: Math.floor(m[1].length / 2), marker: m[2], text: m[3] });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // paragraph — gather wrapped lines until blank or a new block starts
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    blocks.push({ type: 'para', text: buf.join(' ') });
  }
  return blocks;
}

// ---------------- inline parsing ----------------
const INLINE = /(`[^`]+`)|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(~~[^~]+?~~)|(\[[^\]]+\]\([^)]+\))/g;

function inline(text, kp) {
  const out = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(<Text key={`${kp}t${k}`}>{text.slice(last, m.index)}</Text>);
    const tok = m[0];
    if (tok[0] === '`') out.push(<Text key={`${kp}c${k}`} style={md.inlineCode}>{tok.slice(1, -1)}</Text>);
    else if (tok.startsWith('***')) out.push(<Text key={`${kp}bi${k}`} style={md.boldItalic}>{tok.slice(3, -3)}</Text>);
    else if (tok.startsWith('**')) out.push(<Text key={`${kp}b${k}`} style={md.bold}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith('__')) out.push(<Text key={`${kp}b${k}`} style={md.bold}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith('~~')) out.push(<Text key={`${kp}s${k}`} style={md.strike}>{tok.slice(2, -2)}</Text>);
    else if (tok[0] === '[') {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(
        <Text key={`${kp}l${k}`} style={md.link} onPress={() => Linking.openURL(lm[2]).catch(() => {})}>
          {lm[1]}
        </Text>,
      );
    } else out.push(<Text key={`${kp}i${k}`} style={md.italic}>{tok.slice(1, -1)}</Text>);
    last = m.index + tok.length;
    k++;
  }
  if (last < text.length) out.push(<Text key={`${kp}t${k}`}>{text.slice(last)}</Text>);
  return out;
}

// ---------------- block rendering ----------------
function renderBlock(b, i, isLast) {
  const spacer = isLast ? 0 : 12;
  switch (b.type) {
    case 'heading': {
      const hs = [md.h1, md.h1, md.h2, md.h3, md.h4, md.h5, md.h6][b.level] || md.h6;
      return (
        <View key={i} style={{ marginTop: b.level <= 2 ? 16 : 12, marginBottom: 6 }}>
          <Text style={hs}>{inline(b.text, `h${i}`)}</Text>
          {b.level <= 2 ? <View style={md.hRule} /> : null}
        </View>
      );
    }
    case 'para':
      return <Text key={i} style={[md.para, { marginBottom: spacer }]}>{inline(b.text, `p${i}`)}</Text>;
    case 'code':
      return (
        <View key={i} style={[md.codeBlock, { marginBottom: spacer }]}>
          {b.lang ? <Text style={md.codeLang}>{b.lang}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={md.codeText}>{b.text}</Text>
          </ScrollView>
        </View>
      );
    case 'list':
      return (
        <View key={i} style={{ marginBottom: spacer }}>
          {b.items.map((it, j) => (
            <View key={j} style={[md.li, { marginLeft: 2 + it.indent * 16 }]}>
              <Text style={md.liMarker}>{it.ordered ? `${it.marker.replace(/[.)]/, '')}.` : '•'}</Text>
              <Text style={md.liText}>{inline(it.text, `l${i}_${j}`)}</Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View key={i} style={[md.quote, { marginBottom: spacer }]}>
          <Text style={md.quoteText}>{inline(b.text, `q${i}`)}</Text>
        </View>
      );
    case 'table':
      return (
        <View key={i} style={[md.table, { marginBottom: spacer }]}>
          <View style={[md.tr, md.trHead]}>
            {b.header.map((c, ci) => (
              <View key={ci} style={md.td}><Text style={md.thText}>{inline(c, `th${i}_${ci}`)}</Text></View>
            ))}
          </View>
          {b.rows.map((r, ri) => (
            <View key={ri} style={[md.tr, ri % 2 === 1 && md.trAlt, ri === b.rows.length - 1 && { borderBottomWidth: 0 }]}>
              {r.map((c, ci) => (
                <View key={ci} style={md.td}><Text style={md.tdText}>{inline(c, `td${i}_${ri}_${ci}`)}</Text></View>
              ))}
            </View>
          ))}
        </View>
      );
    case 'hr':
      return <View key={i} style={md.hr} />;
    default:
      return null;
  }
}

const md = StyleSheet.create({
  para: { fontSize: 14.5, color: C.text, lineHeight: 23 },
  bold: { fontWeight: '800', color: C.text },
  italic: { fontStyle: 'italic' },
  boldItalic: { fontWeight: '800', fontStyle: 'italic', color: C.text },
  strike: { textDecorationLine: 'line-through', color: C.text2 },
  link: { color: C.accent, textDecorationLine: 'underline' },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#9ECBFF',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  h1: { fontSize: 21, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '700', color: C.text },
  h4: { fontSize: 14.5, fontWeight: '700', color: C.text },
  h5: { fontSize: 13.5, fontWeight: '700', color: C.text2 },
  h6: { fontSize: 12.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  hRule: { height: 1, backgroundColor: C.hairline, marginTop: 6 },
  codeBlock: {
    backgroundColor: '#0D1017',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  codeLang: { fontSize: 10.5, color: C.muted, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6, textTransform: 'uppercase' },
  codeText: { fontFamily: 'monospace', fontSize: 12.5, color: '#C9D4E5', lineHeight: 19 },
  li: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3, gap: 9 },
  liMarker: { fontSize: 14.5, color: C.accent, minWidth: 16, lineHeight: 23, fontWeight: '700' },
  liText: { flex: 1, fontSize: 14.5, color: C.text, lineHeight: 23 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
    backgroundColor: 'rgba(59,130,246,0.06)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  quoteText: { fontSize: 14, color: C.text2, lineHeight: 22, fontStyle: 'italic' },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.hairline },
  trHead: { backgroundColor: C.surface2 },
  trAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  td: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: C.hairline },
  thText: { fontSize: 12.5, fontWeight: '800', color: C.text },
  tdText: { fontSize: 12.5, color: C.text2, lineHeight: 18 },
  hr: { height: 1, backgroundColor: C.border, marginVertical: 14 },
});
