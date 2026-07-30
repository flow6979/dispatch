import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { C } from '../../src/theme';

// Custom tab bar drawn to match the mockup: 4 tabs, accent for active.
function TabBar({ state, descriptors, navigation }) {
  const labels = { index: 'Capture', tasks: 'Tasks', map: 'Map', digest: 'Digest', settings: 'Settings' };
  const glyphs = { index: '◉', tasks: '▤', map: '◈', digest: '☰', settings: '⚙' };
  return (
    <View style={styles.tabs}>
      {state.routes
        .filter((r) => labels[r.name])
        .map((route) => {
          const idx = state.routes.indexOf(route);
          const focused = state.index === idx;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} style={styles.tab} onPress={onPress}>
              <Text style={[styles.ic, focused && styles.on]}>{glyphs[route.name]}</Text>
              <Text style={[styles.label, focused && styles.on]}>{labels[route.name]}</Text>
            </Pressable>
          );
        })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.canvas },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="digest" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabs: {
    height: 66,
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  ic: { fontSize: 20, color: C.muted },
  label: { fontSize: 11, fontWeight: '600', color: C.muted },
  on: { color: C.accent },
});
