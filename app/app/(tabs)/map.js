import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { OfflineBanner } from '../../src/ui';
import { useContext } from '../../src/hooks';
import { api } from '../../src/api';

// Full-screen Cytoscape graph (loaded from CDN — the Map needs network anyway
// to fetch the graph data). Colors nodes by top-level directory, sizes by
// degree, tap-to-focus a node's neighborhood.
function buildHtml(graph) {
  const data = JSON.stringify(graph || { nodes: [], edges: [] });
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body,#cy{margin:0;padding:0;width:100%;height:100%;background:#0E0F13;overflow:hidden}
  #hint{position:fixed;bottom:10px;left:0;right:0;text-align:center;color:#6B7280;font:12px -apple-system,system-ui;pointer-events:none}
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
  try {
    if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose);
    var els = [];
    (G.nodes||[]).forEach(function(n){ els.push({ data:{ id:n.id, label:n.label, group:n.group, deg:n.deg||0 } }); });
    (G.edges||[]).forEach(function(e){ els.push({ data:{ id:e.source+'>'+e.target, source:e.source, target:e.target } }); });
    var cy = cytoscape({
      container: document.getElementById('cy'),
      elements: els,
      style: [
        { selector:'node', style:{
          'background-color': function(n){ return colorFor(n.data('group')); },
          'label':'data(label)', 'color':'#F4F5F7', 'font-size':7,
          'text-valign':'bottom','text-halign':'center','text-margin-y':2,
          'width': function(n){ return 10 + Math.min(28, (n.data('deg')||0)*3); },
          'height': function(n){ return 10 + Math.min(28, (n.data('deg')||0)*3); },
          'border-width':0 } },
        { selector:'edge', style:{
          'width':0.7, 'line-color':'#2E323B', 'curve-style':'haystack',
          'target-arrow-color':'#2E323B','target-arrow-shape':'none','opacity':0.7 } },
        { selector:'.faded', style:{ 'opacity':0.08 } },
        { selector:'.hi', style:{ 'opacity':1, 'line-color':'#3B82F6','width':1.4 } },
      ],
      layout: { name:'fcose', randomize:true, animate:false, numIter:2500, nodeSeparation:75, idealEdgeLength:60, packComponents:true },
      wheelSensitivity:0.2, minZoom:0.1, maxZoom:4,
    });
    cy.on('tap','node', function(evt){
      var n = evt.target; var nb = n.closedNeighborhood();
      cy.elements().addClass('faded'); nb.removeClass('faded'); nb.addClass('hi');
      post({ type:'node', id:n.id(), deg:n.data('deg') });
    });
    cy.on('tap', function(evt){ if(evt.target===cy){ cy.elements().removeClass('faded').removeClass('hi'); } });
    cy.ready(function(){ cy.fit(undefined, 30); post({ type:'ready', nodes:(G.nodes||[]).length, edges:(G.edges||[]).length }); });
  } catch(e){ post({ type:'error', message:String(e) }); }
</script></body></html>`;
}

export default function MapScreen() {
  const { context } = useContext();
  const repo = context?.repo || null;
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('idle');
  const [focus, setFocus] = useState(null);

  const load = useCallback(async () => {
    if (!repo) { setStatus('no-repo'); return; }
    try {
      const r = await api.repoGraph(repo);
      if (r && r.graph && r.graph.nodes && r.graph.nodes.length) {
        setGraph(r.graph); setStatus('ready'); return;
      }
      // trigger a build and poll
      setStatus('building');
      await api.buildRepoGraph(repo);
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        try {
          const rr = await api.repoGraph(repo);
          if (rr && rr.graph && rr.graph.nodes && rr.graph.nodes.length) {
            clearInterval(poll); setGraph(rr.graph); setStatus('ready');
          } else if (rr && rr.status === 'no_runner') {
            clearInterval(poll); setStatus('no-runner');
          } else if (tries > 40) { clearInterval(poll); setStatus('timeout'); }
        } catch (_) {}
      }, 3000);
    } catch (_) { setStatus('error'); }
  }, [repo]);

  useEffect(() => { setGraph(null); setFocus(null); load(); }, [repo, load]);

  const html = useMemo(() => (graph ? buildHtml(graph) : null), [graph]);

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <BackRow title={repo ? `Map · ${repo.split('/').pop()}` : 'Repo Map'} onBack={false} />
      {status === 'no-repo' && (
        <View style={styles.center}><Text style={styles.msg}>Pick a repo on the Capture tab to see its map.</Text></View>
      )}
      {status === 'no-runner' && (
        <View style={styles.center}><Text style={styles.msg}>No runner connected — start your laptop runner to build the map.</Text></View>
      )}
      {(status === 'building' || (status === 'idle' && repo)) && (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.msg}>Building the code map… (one-time per repo)</Text>
        </View>
      )}
      {(status === 'timeout' || status === 'error') && (
        <View style={styles.center}>
          <Text style={styles.msg}>Couldn't build the map.</Text>
          <Pressable style={styles.retry} onPress={load}><Text style={styles.retryTxt}>Retry</Text></Pressable>
        </View>
      )}
      {status === 'ready' && html && (
        <>
          <WebView
            originWhitelist={['*']}
            source={{ html }}
            style={{ flex: 1, backgroundColor: C.canvas }}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(e) => {
              try {
                const m = JSON.parse(e.nativeEvent.data);
                if (m.type === 'node') setFocus(m.id);
              } catch (_) {}
            }}
          />
          {graph && (
            <View style={styles.legend}>
              <Text style={styles.legendTxt}>
                {graph.nodes.length} files · {graph.edges.length} links{focus ? `  ·  ${focus}` : ''}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  msg: { color: C.text2, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  retry: { marginTop: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryTxt: { color: C.text, fontWeight: '700' },
  legend: { position: 'absolute', top: 56, right: 12, backgroundColor: 'rgba(25,27,33,0.85)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  legendTxt: { color: C.text2, fontSize: 11 },
});
