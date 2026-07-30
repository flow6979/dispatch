import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { useContext } from '../../src/hooks';
import { api } from '../../src/api';

const TYPE_META = {
  files: { label: 'Files', hint: 'file ↔ file imports' },
  modules: { label: 'Modules', hint: 'folder architecture' },
  entities: { label: 'Entities', hint: 'data models & types' },
  apiflow: { label: 'API↔DB', hint: 'routes → entities' },
};
const TYPE_ORDER = ['files', 'modules', 'entities', 'apiflow'];

function buildHtml(graph) {
  const data = JSON.stringify(graph || { nodes: [], edges: [] });
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body,#cy{margin:0;padding:0;width:100%;height:100%;background:#0E0F13;overflow:hidden}
  #hint{position:fixed;bottom:10px;left:0;right:0;text-align:center;color:#6B7280;font:12px -apple-system,system-ui;pointer-events:none}
  #empty{position:fixed;top:45%;left:0;right:0;text-align:center;color:#9CA3AF;font:14px -apple-system,system-ui}
</style>
<script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/layout-base@2.0.1/layout-base.js"></script>
<script src="https://unpkg.com/cose-base@2.2.0/cose-base.js"></script>
<script src="https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
</head><body>
<div id="cy"></div>
<div id="hint">pinch to zoom · drag to pan · tap a node to focus</div>
<script>
  var G = ${data};
  var palette = ['#3B82F6','#30D158','#F5A623','#FF453A','#BF5AF2','#5AC8FA','#FF9F0A','#64D2FF','#FFD60A','#AC8E68'];
  var groups = {}; var gi = 0;
  function colorFor(g){ if(!(g in groups)){ groups[g]=palette[gi%palette.length]; gi++; } return groups[g]; }
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if(!(G.nodes||[]).length){
    var d=document.createElement('div'); d.id='empty'; d.textContent='Nothing to show for this view.';
    document.body.appendChild(d); post({type:'ready',nodes:0});
  } else try {
    if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose);
    var els = [];
    (G.nodes||[]).forEach(function(n){ els.push({ data:{ id:n.id, label:n.label, group:n.group, w:(n.size||n.deg||0) } }); });
    (G.edges||[]).forEach(function(e){ els.push({ data:{ id:e.source+'>'+e.target, source:e.source, target:e.target } }); });
    var cy = cytoscape({
      container: document.getElementById('cy'),
      elements: els,
      style: [
        { selector:'node', style:{
          'background-color': function(n){ return colorFor(n.data('group')); },
          'label':'data(label)', 'color':'#F4F5F7', 'font-size':7,
          'text-valign':'bottom','text-halign':'center','text-margin-y':2,
          'width': function(n){ return 10 + Math.min(30, (n.data('w')||0)*3); },
          'height': function(n){ return 10 + Math.min(30, (n.data('w')||0)*3); },
          'border-width':0 } },
        { selector:'edge', style:{
          'width':0.7, 'line-color':'#2E323B', 'curve-style':'bezier',
          'target-arrow-color':'#3E434D','target-arrow-shape':'triangle','arrow-scale':0.5,'opacity':0.6 } },
        { selector:'.faded', style:{ 'opacity':0.07 } },
        { selector:'.hi', style:{ 'opacity':1, 'line-color':'#3B82F6','width':1.4,'target-arrow-color':'#3B82F6' } },
      ],
      layout: { name:'fcose', randomize:true, animate:false, numIter:2500, nodeSeparation:75, idealEdgeLength:65, packComponents:true },
      wheelSensitivity:0.2, minZoom:0.08, maxZoom:4,
    });
    cy.on('tap','node', function(evt){
      var n = evt.target; var nb = n.closedNeighborhood();
      cy.elements().addClass('faded'); nb.removeClass('faded'); nb.addClass('hi');
      post({ type:'node', id:n.id(), label:n.data('label') });
    });
    cy.on('tap', function(evt){ if(evt.target===cy){ cy.elements().removeClass('faded').removeClass('hi'); } });
    cy.ready(function(){ cy.fit(undefined, 30); post({ type:'ready', nodes:(G.nodes||[]).length, edges:(G.edges||[]).length }); });
  } catch(e){ post({ type:'error', message:String(e) }); }
</script></body></html>`;
}

export default function MapScreen() {
  const { context } = useContext();
  const repo = context?.repo || null;
  const [type, setType] = useState('files');
  const [types, setTypes] = useState(TYPE_ORDER);
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('idle');
  const [focus, setFocus] = useState(null);

  const fetchType = useCallback(async (t) => {
    if (!repo) { setStatus('no-repo'); return; }
    setStatus('loading'); setGraph(null); setFocus(null);
    try {
      const r = await api.repoGraph(repo, t);
      if (r && r.types && r.types.length) setTypes(TYPE_ORDER.filter((x) => r.types.includes(x)));
      if (r && r.graph && r.graph.nodes) { setGraph(r.graph); setStatus('ready'); return; }
      setStatus('building');
      await api.buildRepoGraph(repo);
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        try {
          const rr = await api.repoGraph(repo, t);
          if (rr && rr.graph && rr.graph.nodes) {
            clearInterval(poll);
            if (rr.types) setTypes(TYPE_ORDER.filter((x) => rr.types.includes(x)));
            setGraph(rr.graph); setStatus('ready');
          } else if (rr && rr.status === 'no_runner') { clearInterval(poll); setStatus('no-runner'); }
          else if (tries > 40) { clearInterval(poll); setStatus('timeout'); }
        } catch (_) {}
      }, 3000);
    } catch (_) { setStatus('error'); }
  }, [repo]);

  useEffect(() => { fetchType(type); }, [repo, type, fetchType]);

  const html = useMemo(() => (graph ? buildHtml(graph) : null), [graph]);

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <BackRow title={repo ? `Map · ${repo.split('/').pop()}` : 'Repo Map'} onBack={false} />

      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {types.map((t) => (
            <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipOn]}>
              <Text style={[styles.chipTxt, type === t && styles.chipTxtOn]}>{TYPE_META[t]?.label || t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {status === 'no-repo' && <View style={styles.center}><Text style={styles.msg}>Pick a repo on the Capture tab to see its map.</Text></View>}
      {status === 'no-runner' && <View style={styles.center}><Text style={styles.msg}>No runner connected — start your laptop runner to build the map.</Text></View>}
      {(status === 'building' || status === 'loading' || (status === 'idle' && repo)) && (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.msg}>{status === 'building' ? 'Building the code map… (one-time per repo)' : 'Loading…'}</Text>
        </View>
      )}
      {(status === 'timeout' || status === 'error') && (
        <View style={styles.center}>
          <Text style={styles.msg}>Couldn't load this view.</Text>
          <Pressable style={styles.retry} onPress={() => fetchType(type)}><Text style={styles.retryTxt}>Retry</Text></Pressable>
        </View>
      )}
      {status === 'ready' && html && (
        <>
          <WebView
            key={type}
            originWhitelist={['*']}
            source={{ html }}
            style={{ flex: 1, backgroundColor: C.canvas }}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m.type === 'node') setFocus(m.label || m.id); } catch (_) {} }}
          />
          <View style={styles.legend} pointerEvents="none">
            <Text style={styles.legendTxt}>
              {graph.nodes.length} · {graph.edges.length} links{focus ? `  ·  ${focus}` : `  ·  ${TYPE_META[type]?.hint || ''}`}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  chipsWrap: { borderBottomWidth: 1, borderBottomColor: C.border },
  chips: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  chipTxt: { fontSize: 13, color: C.text2, fontWeight: '600' },
  chipTxtOn: { color: C.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  msg: { color: C.text2, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  retry: { marginTop: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryTxt: { color: C.text, fontWeight: '700' },
  legend: { position: 'absolute', bottom: 34, left: 12, backgroundColor: 'rgba(25,27,33,0.9)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  legendTxt: { color: C.text2, fontSize: 11 },
});
