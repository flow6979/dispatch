import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { C } from '../src/theme';
import { StatusBarFaux, BackRow } from '../src/components';
import { CapLabel, Card, Button, OfflineBanner } from '../src/ui';
import { useContext } from '../src/hooks';
import { api } from '../src/api';

// kebab-case slug from a free-text description
function slugify(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

const RECENT = ['fix/webhook-retry', 'staging', 'feat/csv-export'];

export default function BranchPicker() {
  const { context, offline, refresh } = useContext();
  const base = context?.baseBranch || 'main';
  const repo = context?.repo ? context.repo.split('/').pop() : 'repo';
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const generated = desc.trim() ? `fix/${slugify(desc)}` : '';

  async function setBranch(name) {
    if (!context?.repo) {
      router.push('/repo-picker');
      return;
    }
    setBusy(true);
    try {
      await api.setContext({
        repo: context.repo,
        baseBranch: base,
        workBranch: name,
      });
      refresh();
      router.back();
    } catch (e) {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title={`Branch · ${repo}`} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {!creating && (
          <Button
            title="+ Create a new branch"
            variant="sec"
            onPress={() => setCreating(true)}
            style={{ marginBottom: 18 }}
          />
        )}

        <View style={styles.protectedRow}>
          <Text style={styles.branchName}>{base}</Text>
          <View style={styles.lock}>
            <Text style={styles.lockTxt}>🔒 protected</Text>
          </View>
        </View>

        <CapLabel style={{ marginTop: 10 }}>Recent</CapLabel>
        {RECENT.map((b) => (
          <Pressable key={b} style={styles.item} onPress={() => setBranch(b)}>
            <Text style={styles.itemTxt}>⎇ {b}</Text>
            {busy && context?.workBranch === b && (
              <ActivityIndicator size="small" color={C.accent} />
            )}
          </Pressable>
        ))}

        {creating && (
          <Card style={styles.createCard}>
            <Text style={styles.createLabel}>Describe the work</Text>
            <TextInput
              style={styles.createInput}
              placeholder="e.g. the login retry fix"
              placeholderTextColor={C.muted}
              value={desc}
              onChangeText={setDesc}
              autoFocus
            />
            <Text style={styles.willCreate}>I'll create</Text>
            <Text style={styles.gen}>{generated || 'fix/…'}</Text>
            <Text style={styles.off}>off {base}</Text>
            <View style={styles.btnRow}>
              <Button
                title={busy ? '…' : 'Create'}
                small
                style={{ flex: 1 }}
                disabled={!generated || busy}
                onPress={() => setBranch(generated)}
              />
              <Button
                title="Cancel"
                variant="sec"
                small
                style={{ flex: 1 }}
                onPress={() => {
                  setCreating(false);
                  setDesc('');
                }}
              />
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 6 },
  protectedRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  branchName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  lock: { backgroundColor: C.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  lockTxt: { fontSize: 11, color: C.muted },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  itemTxt: { flex: 1, fontSize: 15, color: C.text },
  createCard: { marginTop: 26, borderColor: C.accent },
  createLabel: { fontSize: 12.5, color: C.text2, marginBottom: 6 },
  createInput: {
    height: 42,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: C.text,
    fontSize: 14,
    marginBottom: 12,
    outlineStyle: 'none',
  },
  willCreate: { fontSize: 12, color: C.muted },
  gen: { fontSize: 19, fontWeight: '800', color: C.accent, marginVertical: 3 },
  off: { fontSize: 12, color: C.muted, marginBottom: 14 },
  btnRow: { flexDirection: 'row', gap: 10 },
});
