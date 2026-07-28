import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '../src/theme';

// On web we frame the app inside a phone-shaped surface centered on a dark
// canvas so it renders like the mockup screens. On native it fills the device.
export default function RootLayout() {
  const isWeb = Platform.OS === 'web';
  // On web, RN-Web mounts into #root but the document has no height by default,
  // so flex:1 containers collapse. Force the html/body/#root to fill the viewport.
  useEffect(() => {
    if (isWeb && typeof document !== 'undefined') {
      const html = document.documentElement;
      html.style.height = '100%';
      html.style.margin = '0';
      document.body.style.height = '100%';
      document.body.style.margin = '0';
      const root = document.getElementById('root');
      if (root) {
        root.style.height = '100%';
        root.style.display = 'flex';
      }
    }
  }, [isWeb]);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.outer}>
        <View style={[styles.frame, isWeb && styles.frameWeb]}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: C.canvas },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="repo-picker"
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen
              name="branch-picker"
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="spec/[id]" />
            <Stack.Screen name="tasks/[id]" />
          </Stack>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: '#08090C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { flex: 1, width: '100%', backgroundColor: C.canvas },
  frameWeb: {
    // NB: do NOT use `flex: 0` here — RN-Web emits `flex: 0 1 0%`, and a
    // flex-basis of 0% overrides `height`, collapsing the frame to ~0px.
    // Explicit grow/shrink/basis keeps the fixed 800px height.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: 390,
    height: 800,
    maxHeight: '100%',
    borderRadius: 42,
    borderWidth: 1,
    borderColor: '#2A2D35',
    overflow: 'hidden',
    // subtle bezel
    boxShadow: '0 0 0 10px #16181D, 0 30px 60px rgba(0,0,0,0.55)',
  },
});
