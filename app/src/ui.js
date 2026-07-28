// Shared UI primitives styled to match the mockup.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C, STATUS_COLOR } from './theme';

export function Dot({ status, size = 10, style }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: STATUS_COLOR[status] || C.muted,
        },
        style,
      ]}
    />
  );
}

export function CapLabel({ children, style, color }) {
  return (
    <Text style={[styles.capLabel, color && { color }, style]}>{children}</Text>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'pri', small, style, disabled }) {
  const base = variant === 'pri' ? styles.btnPri : styles.btnSec;
  const txt = variant === 'pri' ? styles.btnPriTxt : styles.btnSecTxt;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSm,
        base,
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      <Text style={[styles.btnTxt, small && styles.btnSmTxt, txt]}>{title}</Text>
    </Pressable>
  );
}

export function OfflineBanner({ visible }) {
  if (!visible) return null;
  return (
    <View style={styles.offline}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.muted }} />
      <Text style={styles.offlineTxt}>backend offline · retrying…</Text>
    </View>
  );
}

export function Meter({ value = 0, color = C.needsyou }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.meter}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  capLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    color: C.muted,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
  },
  btn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSm: { height: 38, borderRadius: 10, paddingHorizontal: 16 },
  btnPri: { backgroundColor: C.accent },
  btnSec: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  btnTxt: { fontSize: 15, fontWeight: '700' },
  btnSmTxt: { fontSize: 13, fontWeight: '600' },
  btnPriTxt: { color: '#fff' },
  btnSecTxt: { color: C.text },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 6,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  offlineTxt: { color: C.muted, fontSize: 12 },
  meter: {
    flex: 1,
    height: 6,
    backgroundColor: C.surface2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
