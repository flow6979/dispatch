import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Tabs } from 'expo-router';
import { C } from '../../src/theme';

function TabButton({ focused, glyph, label, onPress }) {
  const a = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
  }, [focused, a]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const lift = a.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Animated.Text style={[styles.ic, focused && styles.on, { transform: [{ scale }, { translateY: lift }] }]}>
        {glyph}
      </Animated.Text>
      <Text style={[styles.label, focused && styles.on]}>{label}</Text>
    </Pressable>
  );
}

// Custom tab bar drawn to match the mockup, with an animated active icon.
function TabBar({ state, navigation }) {
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
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <TabButton key={route.key} focused={focused} glyph={glyphs[route.name]} label={labels[route.name]} onPress={onPress} />
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
