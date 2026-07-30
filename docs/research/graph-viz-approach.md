# Repo Dependency Graph — "Map" Tab: Rendering Approach

**Status:** Research + recommended implementation
**Target:** Expo SDK 57 (RN 0.86, React 19, New Architecture ON), release APK, offline
**Data:** `{ nodes: [{ id, label, group }], edges: [{ source, target }] }` from a backend endpoint
**Goal:** smooth pinch-zoom/pan of a few hundred nodes, tap-to-focus, node coloring by directory/group

---

## TL;DR recommendation

Use **react-native-webview hosting Cytoscape.js + the `fcose` layout extension**, with the library JS **bundled as a local asset** (not CDN) so it works offline in a release APK. Feed graph JSON in via `injectedJavaScript` / `postMessage`, and receive tap events back via `window.ReactNativeWebView.postMessage`.

This wins on every axis that matters for this feature: production-grade zoom/pan gestures, a genuinely good graph layout out of the box, a few hundred nodes with zero perf worry, and **near-zero native-build risk** (`react-native-webview` is a mature Expo-supported module, so `expo prebuild` + New Architecture "just works").

---

## Approach comparison

### 1. WebView hosting a graph library ✅ (recommended)

Host a full HTML/JS graph engine inside `react-native-webview` and treat it as a tiny embedded web app. Candidate libs:

| Lib | Layout quality | Gestures | Bundle size | Fit for this |
|-----|----------------|----------|-------------|--------------|
| **Cytoscape.js + fcose** | Excellent (fcose/cose-bilkent force layout designed for compound/dependency graphs) | Built-in pinch-zoom, pan, box-select, tap events — tuned for touch | ~1 MB min + ~60 KB fcose | **Best overall** |
| vis-network | Good (Barnes-Hut physics) | Good touch support | ~700 KB | Fine, but weaker theming/styling API and layout control than cytoscape |
| sigma.js (v2/v3) | Needs graphology + a layout worker; WebGL renderer | Good, WebGL = very fast at 10k+ nodes | ~300 KB + graphology + layout pkgs | Overkill; only worth it at thousands of nodes. More wiring. |
| d3-force (in webview) | You hand-roll layout + SVG/canvas rendering + gestures | You wire zoom/pan yourself (d3-zoom) | small | More work than cytoscape for a worse result |

**Pros**
- Best-in-class **gesture quality**: browser pinch-zoom/pan is buttery and battle-tested; no gesture math to write.
- **Real layout algorithms** (fcose) produce readable dependency graphs immediately — the hard part is solved for you.
- Rich, declarative **styling** (color by directory, size by degree, edge arrows) via cytoscape's stylesheet.
- **Perf**: a few hundred nodes on canvas is trivial; cytoscape comfortably handles 1–2k nodes on a phone.
- **Cross-platform for free** (same code renders on iOS + web).
- Layout compute happens off the RN JS thread (inside the WebView), so the app UI stays responsive.

**Cons**
- WebView bridge is async — you serialize JSON across the boundary (fine for a few hundred nodes; keep payload < a few MB).
- Need `react-native-webview` as a native dep (but it's Expo-supported; low risk).
- To be **offline** you must bundle the lib JS locally, not `<script src="https://cdn...">`.

**Offline strategy (important):** inline the minified library source directly into the HTML string, or bundle it as an asset and read it at runtime. Inlining is the most robust for a release APK — no file:// path or `allowFileAccess` platform quirks, no asset-resolution failures. The cost is a larger JS bundle string, which is fine.

### 2. Native `react-native-svg` + `gesture-handler` + `reanimated` + JS `d3-force`

Run a d3-force simulation in RN's JS thread, render nodes/edges as `react-native-svg` elements, and drive pan/pinch with `react-native-gesture-handler` + `reanimated`.

**Pros**
- No WebView; "pure native" rendering, integrates with RN theming directly.
- Full control over interactions and look.

**Cons**
- **Big effort.** You reimplement what cytoscape gives free: layout tuning, zoom-to-fit, hit-testing, edge routing, labels-on-zoom, tap-to-focus.
- **Perf risk.** `react-native-svg` degrades with a few hundred simultaneously-animated nodes; the force simulation on the JS thread competes with gestures. Getting 60fps pinch-zoom over 300 SVG nodes is genuinely hard.
- More native deps (`svg`, `gesture-handler`, `reanimated`) = more prebuild/New-Arch surface than a single WebView.
- d3-force layout is decent but you still hand-tune it; no compound/fcose-quality result.

Verdict: only pick this if a WebView is categorically disallowed. For "a few hundred nodes with smooth zoom", it's more work for a worse result.

### 3. Expo-compatible graph libraries (native RN)

- No maintained, high-quality **native RN graph library** exists that does force layout + smooth zoom for hundreds of nodes. Options are either thin d3-force wrappers (small node counts, choppy), abandoned, or Skia-based experiments (`@shopify/react-native-skia` can render fast, but you still build layout + gestures + hit-testing yourself — same effort as approach 2 with a different renderer).
- `@shopify/react-native-skia` is worth noting as the *future* high-perf native path (Skia canvas, works with reanimated, New-Arch friendly) if you ever need thousands of nodes rendered natively — but it's a build-it-yourself engine, not a graph library.

Verdict: nothing off-the-shelf here beats approach 1 for this use case.

---

## Decision

**Approach 1 — WebView + Cytoscape.js + fcose, library inlined for offline.**

Rationale mapped to the stated constraints:
- *Smooth pinch-zoom/pan of a few hundred nodes* → cytoscape's native browser gestures + canvas renderer nail this.
- *Works in a release APK offline* → inline the lib into the HTML string; no network, no CDN, no file:// quirks.
- *Minimal native-build risk (prebuild, RN 0.86, New Arch)* → one mature, Expo-supported native module (`react-native-webview`) vs. three (`svg` + `gesture-handler` + `reanimated`) for the native route.
- *Least code to a good result* → fcose layout + a stylesheet is ~40 lines vs. a hand-rolled engine.

---

## Implementation

### 0. Install

```bash
npx expo install react-native-webview
# then, because we added a native module:
npx expo prebuild --clean      # or: eas build (managed)
```

No config-plugin needed — `react-native-webview` autolinks and is New-Architecture compatible. Nothing else to add to `app.json`.

> We intentionally do **not** rely on `expo-asset` / `expo-file-system` here. The cytoscape + fcose source is inlined into the HTML string (see §1), which is the simplest thing that is guaranteed to work offline in a release APK.

### 1. Getting the cytoscape + fcose source for inlining

At build/author time, grab the minified UMD builds and paste them into a JS module as template strings. Two small vendored files:

```bash
# one-time, into app/src/graph/vendor/
curl -Lo cytoscape.min.js   https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js
curl -Lo layout-base.js     https://unpkg.com/layout-base@2.0.1/layout-base.js
curl -Lo cose-base.js       https://unpkg.com/cose-base@2.2.0/cose-base.js
curl -Lo fcose.js           https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js
```

Then a tiny module exports them as strings so Metro bundles them into the JS bundle (works offline, no asset resolution):

```js
// app/src/graph/vendor/index.js
// These are the raw UMD sources, exported as strings.
// (Generated by a small script; committed to the repo so the build is offline.)
export { default as CYTOSCAPE_SRC } from './cytoscape.min.js.txt';
export { default as LAYOUT_BASE_SRC } from './layout-base.js.txt';
export { default as COSE_BASE_SRC } from './cose-base.js.txt';
export { default as FCOSE_SRC } from './fcose.js.txt';
```

To import `.txt` (or `.js` as raw text) via Metro, add a `metro.config.js`:

```js
// app/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// treat vendored graph libs as plain-text assets we can import as strings
config.resolver.assetExts.push('txt');
module.exports = config;
```

> Simpler alternative if you don't want the Metro text-asset dance: paste the four minified sources directly into a single `graphHtml.js` template literal (escape backticks/`${`). Uglier diff, but zero Metro config. For a hackathon-speed path this is totally fine.

### 2. The HTML/JS document (the graph engine)

`app/src/graph/graphHtml.js` — builds the full HTML string. The library sources are injected via `<script>...inline...</script>`, so there is **no network dependency**.

```js
// app/src/graph/graphHtml.js
import { CYTOSCAPE_SRC, LAYOUT_BASE_SRC, COSE_BASE_SRC, FCOSE_SRC } from './vendor';

// Dark theme tokens mirrored from src/theme.js so the graph matches the app.
const THEME = {
  bg: '#0E0F13',
  edge: '#2E323B',
  edgeActive: '#3B82F6',
  label: '#9CA3AF',
  labelActive: '#F4F5F7',
};

// Deterministic color per top-level directory / group.
const PALETTE = [
  '#3B82F6', '#30D158', '#F5A623', '#FF453A', '#BF5AF2',
  '#5AC8FA', '#FF9F0A', '#64D2FF', '#FF6482', '#A0E070',
];

export function buildGraphHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html, body, #cy { margin:0; padding:0; width:100%; height:100%; background:${THEME.bg}; overflow:hidden; }
  #cy { position:fixed; inset:0; }
</style>
</head>
<body>
<div id="cy"></div>

<!-- === inlined libraries (offline) === -->
<script>${CYTOSCAPE_SRC}</script>
<script>${LAYOUT_BASE_SRC}</script>
<script>${COSE_BASE_SRC}</script>
<script>${FCOSE_SRC}</script>
<script>
  // register the fcose layout with cytoscape
  if (window.cytoscapeFcose) window.cytoscape.use(window.cytoscapeFcose);
</script>
<!-- === app logic === -->
<script>
  var PALETTE = ${JSON.stringify(PALETTE)};
  var THEME = ${JSON.stringify(THEME)};

  // stable hash so a given group always maps to the same color
  function colorForGroup(g) {
    g = String(g || 'root');
    var h = 0;
    for (var i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  var cy = null;

  // Called by RN with the graph JSON.
  window.renderGraph = function (data) {
    try {
      var nodes = (data.nodes || []).map(function (n) {
        return { data: { id: String(n.id), label: n.label || n.id, group: n.group || 'root' } };
      });
      var edges = (data.edges || []).map(function (e, i) {
        return { data: { id: 'e' + i, source: String(e.source), target: String(e.target) } };
      });

      if (cy) { cy.destroy(); cy = null; }

      cy = window.cytoscape({
        container: document.getElementById('cy'),
        elements: { nodes: nodes, edges: edges },
        wheelSensitivity: 0.2,
        minZoom: 0.05,
        maxZoom: 4,
        pixelRatio: 1,               // keep GPU work down on mobile
        textureOnViewport: true,     // render a texture while panning/zooming = smooth
        hideEdgesOnViewport: true,   // hide edges mid-gesture for extra smoothness
        style: [
          { selector: 'node', style: {
              'background-color': function (ele) { return colorForGroup(ele.data('group')); },
              'label': 'data(label)',
              'font-size': 9,
              'color': THEME.label,
              'text-valign': 'bottom',
              'text-margin-y': 3,
              'width': 'mapData(degree, 0, 20, 12, 40)', // set below
              'height': 'mapData(degree, 0, 20, 12, 40)',
              'min-zoomed-font-size': 6,   // hide labels when zoomed way out
              'border-width': 0,
          }},
          { selector: 'edge', style: {
              'width': 1,
              'line-color': THEME.edge,
              'target-arrow-color': THEME.edge,
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.6,
              'curve-style': 'straight',
              'opacity': 0.6,
          }},
          // focus styling
          { selector: '.faded',   style: { 'opacity': 0.12 } },
          { selector: '.focus',   style: {
              'border-width': 2, 'border-color': THEME.edgeActive,
              'color': THEME.labelActive, 'z-index': 10,
          }},
          { selector: 'edge.focus', style: {
              'line-color': THEME.edgeActive, 'target-arrow-color': THEME.edgeActive,
              'opacity': 1, 'width': 2,
          }},
        ],
      });

      // size nodes by degree (connection count) for a readable "map"
      cy.nodes().forEach(function (n) { n.data('degree', n.degree()); });

      cy.layout({
        name: 'fcose',
        quality: 'default',
        animate: false,          // no animation on first paint = faster, cheaper
        randomize: true,
        nodeSeparation: 75,
        idealEdgeLength: 60,
        nodeRepulsion: 6000,
        numIter: 2500,
        packComponents: true,    // keep disconnected clusters tidy
      }).run();

      cy.fit(undefined, 40);

      // tap-to-focus: highlight node + its neighborhood, dim the rest
      cy.on('tap', 'node', function (evt) {
        var n = evt.target;
        var nhood = n.closedNeighborhood();
        cy.elements().addClass('faded');
        nhood.removeClass('faded').addClass('focus');
        cy.animate({ fit: { eles: nhood, padding: 60 }, duration: 250 });
        post({ type: 'nodeTap', id: n.id(), label: n.data('label'), group: n.data('group') });
      });

      // tap empty background: clear focus
      cy.on('tap', function (evt) {
        if (evt.target === cy) {
          cy.elements().removeClass('faded focus');
          post({ type: 'clearFocus' });
        }
      });

      post({ type: 'ready', nodes: nodes.length, edges: edges.length });
    } catch (err) {
      post({ type: 'error', message: String(err && err.message || err) });
    }
  };

  post({ type: 'loaded' });   // tell RN the JS engine is up and window.renderGraph exists
</script>
</body>
</html>`;
}
```

### 3. The React Native wrapper component

`app/src/graph/DependencyGraph.js` — owns the WebView, injects JSON after the engine reports `loaded`, and surfaces tap events.

```js
// app/src/graph/DependencyGraph.js
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../theme';
import { buildGraphHtml } from './graphHtml';

export default function DependencyGraph({ data, onNodeTap, onClearFocus }) {
  const webRef = useRef(null);
  const [engineReady, setEngineReady] = useState(false);

  // Build the HTML once. `data` is pushed in imperatively (below), not baked in,
  // so we can refresh the graph without reloading the whole WebView.
  const html = useMemo(() => buildGraphHtml(), []);

  // Push JSON into the WebView. Safe against the "not ready yet" race:
  // we (a) call it when the engine says loaded, and (b) call it on data change
  // if the engine is already up.
  const pushData = useCallback((graph) => {
    if (!webRef.current || !graph) return;
    const payload = JSON.stringify(graph);
    // window.renderGraph is defined by the inlined engine script.
    webRef.current.injectJavaScript(
      `window.renderGraph && window.renderGraph(${payload}); true;`
    );
  }, []);

  const onMessage = useCallback(
    (event) => {
      let msg;
      try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
      switch (msg.type) {
        case 'loaded':
          setEngineReady(true);
          pushData(data);              // engine is up → send the graph
          break;
        case 'nodeTap':
          onNodeTap && onNodeTap(msg);
          break;
        case 'clearFocus':
          onClearFocus && onClearFocus();
          break;
        case 'error':
          // surface to your logger; kept quiet in UI
          if (__DEV__) console.warn('[graph]', msg.message);
          break;
        default:
          break;
      }
    },
    [data, pushData, onNodeTap, onClearFocus]
  );

  // If `data` changes after the engine is already ready, re-push.
  React.useEffect(() => {
    if (engineReady) pushData(data);
  }, [engineReady, data, pushData]);

  return (
    <View style={styles.fill}>
      <WebView
        ref={webRef}
        style={styles.fill}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        // perf / behavior
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"       // GPU-composited = smoother zoom on Android
        overScrollMode="never"
        setBuiltInZoomControls={false}    // we do our own gesture handling in cytoscape
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        // offline: no network needed, but keep it strict
        cacheEnabled={false}
        incognito
      />
      {!engineReady && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.accent} />
          <Text style={styles.hint}>Building map…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.canvas },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.canvas,
  },
  hint: { color: C.text2, fontSize: 12 },
});
```

### 4. The "Map" tab screen

`app/app/(tabs)/map.js` — fetches JSON from the backend and renders the graph. Follows the app's existing `api` client and theme conventions.

```js
// app/app/(tabs)/map.js
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../../src/theme';
import { api } from '../../src/api';                 // add api.graph() — see note below
import DependencyGraph from '../../src/graph/DependencyGraph';

export default function MapScreen() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [focus, setFocus] = useState(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const g = await api.graph();       // { nodes, edges }
      setData(g);
    } catch (e) {
      setErr(String(e && e.message || e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.fill} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Map</Text>
        {focus ? (
          <Text style={styles.focus} numberOfLines={1}>{focus.label}</Text>
        ) : (
          <Text style={styles.sub}>tap a node to focus</Text>
        )}
      </View>

      {err ? (
        <Pressable style={styles.err} onPress={load}>
          <Text style={styles.errText}>Couldn’t load map — tap to retry</Text>
        </Pressable>
      ) : (
        <DependencyGraph
          data={data}
          onNodeTap={setFocus}
          onClearFocus={() => setFocus(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.canvas },
  header: {
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'baseline', gap: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  title: { color: C.text, fontSize: 20, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12 },
  focus: { color: C.accent, fontSize: 12, flex: 1 },
  err: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { color: C.text2 },
});
```

**Add the endpoint to the api client** (`app/src/api.js`, in the `api` object):

```js
graph: () => req('/api/graph'),   // backend returns { nodes:[{id,label,group}], edges:[{source,target}] }
```

**Register the tab** (`app/app/(tabs)/_layout.js`): add `map` to `labels`/`glyphs` and a `<Tabs.Screen name="map" />`. Example:

```js
const labels = { index: 'Capture', tasks: 'Tasks', map: 'Map', digest: 'Digest', settings: 'Settings' };
const glyphs = { index: '◉', tasks: '▤', map: '◆', digest: '☰', settings: '⚙' };
// ...
<Tabs.Screen name="map" />
```

---

## Recommended defaults (tuned for this feature)

- **Layout:** `fcose` (fast Compound Spring Embedder). `randomize: true`, `animate: false` on first paint, `numIter: 2500`, `nodeSeparation: 75`, `idealEdgeLength: 60`, `packComponents: true`. fcose is the sweet spot: much faster than `cose-bilkent`, better quality than plain `cose`, great for a few hundred nodes. Use `cose` only if you can't ship the extra fcose files; use `cose-bilkent` only if you specifically need compound/parent nodes and can eat the slower layout.
- **Color by directory/group:** hash the `group` string → stable index into a fixed palette (see `colorForGroup`). Consistent colors across reloads. If `group` is a path, take the top-level segment (`group.split('/')[0]`) before hashing so a whole directory shares a hue.
- **Node size by degree:** `mapData(degree, 0, 20, 12, 40)` so hubs read as bigger — turns the graph into a real "map" where important modules pop.
- **Labels:** `min-zoomed-font-size: 6` hides labels when zoomed out (declutter), reveals them as you zoom in — exactly the "zoom into a code map" behavior requested.
- **Gesture smoothness knobs:** `textureOnViewport: true`, `hideEdgesOnViewport: true`, `pixelRatio: 1`, `androidLayerType="hardware"`. These are the difference between janky and smooth on a mid-range Android phone.
- **Tap-to-focus:** on node tap, highlight `closedNeighborhood()`, fade everything else, animate `fit` to the neighborhood, and post the node back to RN so the header can show context. Tap empty background clears focus.
- **Scale limits:** `minZoom: 0.05`, `maxZoom: 4`, `wheelSensitivity: 0.2`.

## Scaling notes / when to revisit

- **Up to ~500 nodes:** the above is smooth with default (canvas) renderer. No changes needed.
- **500–2000 nodes:** compute layout with `animate:false`, keep `hideEdgesOnViewport`, consider `quality: 'draft'` for fcose, and lazy-reveal labels only under a zoom threshold. Still fine in a WebView.
- **>2–3k nodes:** move to `sigma.js` (WebGL) inside the same WebView, or the native Skia path. Not needed for the stated "few hundred".
- **Payload:** a few hundred nodes/edges is tens of KB of JSON — trivial to `injectJavaScript`. If it ever exceeds ~a few MB, chunk it or `postMessage` in parts.

## Native-build risk summary (why this is the low-risk choice)

- Only **one** added native module: `react-native-webview` — first-class Expo support, autolinks, New-Architecture (Fabric) compatible on RN 0.86. `expo prebuild --clean` regenerates `android/` cleanly; nothing manual.
- No `reanimated`/`gesture-handler` version-matrix headaches, no custom Skia build.
- Offline is guaranteed because the graph engine is **inlined into the JS bundle** — no CDN, no runtime asset fetch, no `file://` access flags. The APK already declares `INTERNET`; the graph itself needs no network beyond the one JSON fetch.
