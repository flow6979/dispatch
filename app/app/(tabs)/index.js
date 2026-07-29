import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { router } from 'expo-router';

// On-device speech-to-text (free, no API key). Loaded defensively so the app
// still runs if the native module isn't available (e.g. web, or a device with
// no speech recognizer) — the mic just falls back to a text-only hint.
let Speech = null;
try {
  Speech = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch (_) {
  Speech = null;
}
const VOICE_AVAILABLE = !!Speech && Platform.OS !== 'web';
import { C, statusOf } from '../../src/theme';
import { StatusBarFaux, ContextBar, TaskRow } from '../../src/components';
import { CapLabel, OfflineBanner, NoRunnerBanner } from '../../src/ui';
import { useTasks, useContext, useHealth } from '../../src/hooks';
import { api } from '../../src/api';

export default function Capture() {
  const { tasks, offline, refresh } = useTasks();
  const { context } = useContext();
  const { health } = useHealth();
  const noRunner = !offline && (health?.runners ?? 0) === 0;
  const pendingApproval = noRunner && (health?.pendingRunners ?? 0) > 0;
  const hasRepo = !!context?.repo;
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [voiceErr, setVoiceErr] = useState(null);
  const baseTextRef = useRef('');

  const recent = tasks.slice(0, 5);

  // Wire speech-recognition events once (uses the module's event emitter so we
  // can guard on availability rather than a conditionally-called hook).
  useEffect(() => {
    if (!VOICE_AVAILABLE) return;
    const subs = [];
    try {
      subs.push(
        Speech.addListener('result', (e) => {
          const phrase = (e.results && e.results[0] && e.results[0].transcript) || '';
          if (phrase) {
            const base = baseTextRef.current;
            setText((base ? base + ' ' : '') + phrase);
          }
        }),
      );
      subs.push(
        Speech.addListener('error', (e) => {
          setVoiceErr((e && (e.message || e.error)) || 'Voice failed — type instead.');
          setListening(false);
        }),
      );
      subs.push(Speech.addListener('end', () => setListening(false)));
    } catch (_) { /* ignore */ }
    return () => { subs.forEach((s) => { try { s.remove(); } catch (_) {} }); };
  }, []);

  async function toggleVoice() {
    if (!VOICE_AVAILABLE) {
      setVoiceErr('Voice not available on this device — type below.');
      return;
    }
    setVoiceErr(null);
    if (listening) {
      try { Speech.stop(); } catch (_) {}
      setListening(false);
      return;
    }
    try {
      const perm = await Speech.requestPermissionsAsync();
      if (!perm || !perm.granted) {
        setVoiceErr('Microphone permission denied.');
        return;
      }
      baseTextRef.current = text.trim();
      setListening(true);
      Speech.start({ lang: 'en-US', interimResults: true, continuous: false });
    } catch (e) {
      setVoiceErr('Could not start voice — type below.');
      setListening(false);
    }
  }

  async function submit() {
    const promptText = text.trim();
    if (!promptText || submitting) return;
    setSubmitting(true);
    setSendError(null);
    try {
      const res = await api.createTask({
        promptText,
        repo: context?.repo || null,
        baseBranch: context?.baseBranch || null,
        workBranch: context?.workBranch || null,
      });
      setText('');
      refresh();
      const t = res && res.task;
      if (t && statusOf(t.state) === 'needsyou') {
        router.push(`/spec/${t.id}`);
      }
    } catch (e) {
      // Surface the failure instead of silently swallowing it — the backend
      // may be waking from sleep (cold start) or unreachable. Keep the text.
      const detail = (e && e.message) ? String(e.message).slice(0, 140) : 'unknown error';
      setSendError(`Couldn't create task: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <NoRunnerBanner visible={noRunner} pending={pendingApproval} />
      <ContextBar context={context} offline={offline} />

      <View style={styles.captureArea}>
        <Pressable
          onPress={toggleVoice}
          style={[styles.mic, listening && styles.micOn]}
        >
          <View style={styles.micStand} />
          <View style={styles.micBody} />
        </Pressable>
        <Text style={styles.hint}>
          {voiceErr
            ? voiceErr
            : listening
            ? 'Listening… tap to stop'
            : VOICE_AVAILABLE
            ? 'Tap to speak'
            : 'Type your task below'}
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="or type a task…"
            placeholderTextColor={C.muted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            returnKeyType="send"
            multiline={false}
          />
          <Pressable
            style={[styles.send, (!text.trim() || submitting) && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!text.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendTxt}>→</Text>
            )}
          </Pressable>
        </View>
        {!hasRepo && !sendError && (
          <Pressable onPress={() => router.push('/repo-picker')}>
            <Text style={styles.repoHint}>
              No repo selected — tap to choose one so tasks can run.
            </Text>
          </Pressable>
        )}
        {!!sendError && <Text style={styles.sendError}>{sendError}</Text>}
      </View>

      <View style={styles.divider} />

      <View style={styles.recent}>
        <CapLabel>Recent</CapLabel>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {recent.length === 0 && (
            <Text style={styles.empty}>
              {offline ? 'Waiting for backend…' : 'No tasks yet. Capture one above.'}
            </Text>
          )}
          {recent.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onPress={() =>
                statusOf(t.state) === 'needsyou'
                  ? router.push(`/spec/${t.id}`)
                  : router.push(`/tasks/${t.id}`)
              }
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  captureArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  mic: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 30px rgba(59,130,246,0.45)',
  },
  micOn: { backgroundColor: C.needsyou },
  micBody: { width: 22, height: 34, backgroundColor: '#fff', borderRadius: 11 },
  micStand: {
    position: 'absolute',
    bottom: 30,
    width: 30,
    height: 14,
    borderWidth: 3,
    borderTopWidth: 0,
    borderColor: '#fff',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  hint: { fontSize: 14, color: C.text2 },
  repoHint: { fontSize: 12.5, color: C.needsyou, textAlign: 'center', marginTop: 4 },
  sendError: { fontSize: 12.5, color: C.blocked, textAlign: 'center', marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  input: {
    flex: 1,
    height: 52,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    color: C.text,
    fontSize: 14,
    outlineStyle: 'none',
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontSize: 22, fontWeight: '700' },
  divider: { height: 1, backgroundColor: C.border },
  recent: { flex: 1, paddingHorizontal: 20, paddingTop: 12, maxHeight: 240 },
  empty: { color: C.muted, fontSize: 13, paddingVertical: 16 },
});
