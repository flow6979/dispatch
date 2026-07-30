// Lightweight animation helpers built on RN's Animated (native-driver, so they
// run on the UI thread and are Fabric/new-arch safe — no extra native deps).
import React, { useRef, useEffect } from 'react';
import { Animated, Pressable, Easing } from 'react-native';

// A Pressable that springs down slightly while pressed — used for buttons,
// task rows and chips to give tactile feedback.
export function PressableScale({ children, style, onPress, onLongPress, disabled, scaleTo = 0.96, hitSlop, ...rest }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 5 }).start();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      disabled={disabled}
      hitSlop={hitSlop}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Fade + slide-up on mount. `delay` lets callers stagger a list.
export function FadeIn({ children, style, delay = 0, from = 10, duration = 300 }) {
  const o = useRef(new Animated.Value(0)).current;
  const t = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(o, { toValue: 1, duration, delay, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(t, { toValue: 0, duration, delay, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[style, { opacity: o, transform: [{ translateY: t }] }]}>{children}</Animated.View>;
}

// A looping pulse value (0..1) that runs only while `active`. Map it to scale/
// opacity for a breathing effect (e.g. the mic while listening).
export function usePulse(active) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop;
    if (active) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(p, { toValue: 1, duration: 850, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(p, { toValue: 0, duration: 850, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      );
      loop.start();
    } else {
      p.stopAnimation(); p.setValue(0);
    }
    return () => loop && loop.stop();
  }, [active, p]);
  return p;
}

// An always-on slow breathing value (0..1) for idle "alive" glows — subtler and
// slower than usePulse. Map to a faint opacity/scale on a ring behind an element.
export function useBreathe(duration = 2200) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(p, { toValue: 1, duration, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(p, { toValue: 0, duration, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p, duration]);
  return p;
}

// Animate a numeric value smoothly toward `value`; returns the rounded display
// number. Used for the token/$ counter climbing.
export function useCountUp(value, duration = 600) {
  const a = useRef(new Animated.Value(Number(value) || 0)).current;
  const [display, setDisplay] = React.useState(Number(value) || 0);
  useEffect(() => {
    const id = a.addListener(({ value: v }) => setDisplay(v));
    Animated.timing(a, { toValue: Number(value) || 0, duration, useNativeDriver: false, easing: Easing.out(Easing.cubic) }).start();
    return () => a.removeListener(id);
  }, [value, a, duration]);
  return display;
}
