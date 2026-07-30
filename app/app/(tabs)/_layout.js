import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C } from '../../src/theme';

const META = {
  index: { label: 'Capture', icon: 'mic' },
  tasks: { label: 'Tasks', icon: 'layers' },
  map: { label: 'Map', icon: 'share-2' },
  digest: { label: 'Digest', icon: 'sunrise' },
  settings: { label: 'Settings', icon: 'settings' },
};

function TabButton({ focused, icon, label, onPress }) {
  const a = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 16, bounciness: 10 }).start();
  }, [focused, a]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const lift = a.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Animated.View style={[styles.iconPill, focused && styles.iconPillOn, { transform: [{ scale }, { translateY: lift }] }]}>
        <Feather name={icon} size={20} color={focused ? C.accent : C.muted} />
      </Animated.View>
      <Text style={[styles.label, focused && styles.on]}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ state, navigation }) {
  return (
    <View style={styles.tabs}>
      {state.routes
        .filter((r) => META[r.name])
        .map((route) => {
          const idx = state.routes.indexOf(route);
          const focused = state.index === idx;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <TabButton key={route.key} focused={focused} icon={META[route.name].icon} label={META[route.name].label} onPress={onPress} />
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
    height: 74,
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
    paddingBottom: 10,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  iconPill: {
    width: 46,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillOn: { backgroundColor: C.accentSoft },
  label: { fontSize: 11, fontWeight: '600', color: C.muted, letterSpacing: 0.2 },
  on: { color: C.accent },
});
