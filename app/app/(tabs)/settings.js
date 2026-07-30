import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, ActivityIndicator, Modal, TextInput } from 'react-native';
import { C } from '../../src/theme';
import { StatusBarFaux, BackRow } from '../../src/components';
import { CapLabel, Dot, OfflineBanner } from '../../src/ui';
import { useRunners, useSettings, useGithub } from '../../src/hooks';
import { api } from '../../src/api';

const DIGEST_TIMES = ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00', 'off'];
const BUDGETS = [1, 2, 3, 5, 10, 20];

function fmtTime(t) {
  if (!t || t === 'off') return 'Off';
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

// Simple option-picker modal (avoids native date pickers / deps).
function PickerModal({ visible, title, options, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {options.map((o) => (
            <Pressable key={String(o.value)} style={styles.opt} onPress={() => { onSelect(o.value); onClose(); }}>
              <Text style={styles.optTxt}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

function Row({ label, value, onPress, children, accent }) {
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children || <Text style={[styles.rowVal, accent && { color: C.accent }]}>{value}</Text>}
    </Pressable>
  );
}

export default function Settings() {
  const { runners, offline } = useRunners();
  const { settings, refresh: refreshSettings } = useSettings();
  const { github, refresh: refreshGithub } = useGithub();
  const [acting, setActing] = useState(null);
  const [pairCode, setPairCode] = useState(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairErr, setPairErr] = useState(null);
  const [picker, setPicker] = useState(null); // 'digest'|'autonomy'|'budget'|'github'|null
  const [budgetInput, setBudgetInput] = useState('');

  const s = settings || { digestTime: '07:30', autonomy: 'auto', taskBudgetUsd: 3, push: true, quietHours: true };

  async function save(patch) {
    try { await api.setSettings(patch); refreshSettings(); } catch (_) {}
  }
  async function approve(id) { setActing(id); try { await api.approveRunner(id); } catch (_) {} finally { setActing(null); } }
  async function revoke(id) { setActing(id); try { await api.revokeRunner(id); } catch (_) {} finally { setActing(null); } }
  async function selectRunner(id) { setActing(id); try { await api.selectRunner(id); } catch (_) {} finally { setActing(null); } }

  const approvedCount = runners.filter((r) => r.paired).length;

  async function genPairCode() {
    setPairBusy(true); setPairErr(null); setPairCode(null);
    try { const r = await api.newPairingCode(); if (r && r.code) setPairCode(r.code); else setPairErr('No code returned'); }
    catch (e) { setPairErr(e.message || 'Failed — check connection'); }
    finally { setPairBusy(false); }
  }
  async function switchAccount(user) { setActing('gh'); try { await api.switchGithub(user); setTimeout(refreshGithub, 1500); } catch (_) {} finally { setActing(null); } }
  async function logoutAccount(user) { setActing('gh'); try { await api.logoutGithub(user); setTimeout(refreshGithub, 1500); } catch (_) {} finally { setActing(null); } }

  return (
    <View style={styles.screen}>
      <StatusBarFaux />
      <OfflineBanner visible={offline} />
      <BackRow title="Settings" onBack={false} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <CapLabel style={styles.head}>Runners</CapLabel>
        {runners.length === 0 && (
          <View style={styles.row}>
            <Dot status="blocked" style={{ marginRight: 11 }} />
            <View style={{ flex: 1 }}><Text style={styles.rowLabel}>No machine connected</Text>
              <Text style={styles.rowSub}>{offline ? 'backend offline' : 'start the runner on your laptop'}</Text></View>
          </View>
        )}
        {runners.map((r) => (
          <Pressable key={r.id} style={styles.row} onPress={r.paired && !r.selected ? () => selectRunner(r.id) : undefined}>
            {r.paired ? (
              <View style={[styles.radio, r.selected && styles.radioOn]}>
                {r.selected ? <View style={styles.radioDot} /> : null}
              </View>
            ) : (
              <Dot status="needsyou" style={{ marginRight: 11 }} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.host || r.name}</Text>
              <Text style={styles.rowSub}>
                {r.ghUser ? `@${r.ghUser}` : 'unknown'} · {r.paired ? (r.active ? 'in use' : 'approved') : 'awaiting approval'}
              </Text>
            </View>
            {acting === r.id ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : r.paired ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {r.selected
                  ? <Text style={[styles.action, { color: C.ready }]}>✓ Using</Text>
                  : <Pressable onPress={() => selectRunner(r.id)}><Text style={[styles.action, { color: C.accent }]}>Use</Text></Pressable>}
                <Pressable onPress={() => revoke(r.id)} hitSlop={8}><Text style={[styles.action, { color: C.muted, marginLeft: 16 }]}>Revoke</Text></Pressable>
              </View>
            ) : (
              <Pressable onPress={() => approve(r.id)}><Text style={[styles.action, { color: C.accent }]}>Approve</Text></Pressable>
            )}
          </Pressable>
        ))}
        {approvedCount > 1 && <Text style={styles.hint}>Tap a machine to send your tasks to it.</Text>}

        <CapLabel style={styles.head}>Devices</CapLabel>
        <Pressable style={styles.row} onPress={genPairCode} disabled={pairBusy}>
          <Text style={[styles.rowLabel, { color: C.accent }]}>{pairBusy ? 'Generating…' : '+ Pair another device'}</Text>
        </Pressable>
        {pairCode ? (
          <View style={{ paddingVertical: 8 }}>
            <Text style={styles.pairCode}>{pairCode}</Text>
            <Text style={styles.hint}>Enter this code in the Dispatch app on the other device (valid 30 min).</Text>
          </View>
        ) : null}
        {pairErr ? <Text style={[styles.hint, { color: C.blocked }]}>{pairErr}</Text> : null}

        <CapLabel style={styles.head}>Notifications</CapLabel>
        <Row label="Push"><Switch value={!!s.push} onValueChange={(v) => save({ push: v })} trackColor={{ true: C.accent, false: C.surface2 }} thumbColor="#fff" /></Row>
        <Row label="Digest time" value={fmtTime(s.digestTime)} onPress={() => setPicker('digest')} accent />
        <Row label="Quiet hours"><Switch value={!!s.quietHours} onValueChange={(v) => save({ quietHours: v })} trackColor={{ true: C.accent, false: C.surface2 }} thumbColor="#fff" /></Row>

        <CapLabel style={styles.head}>Defaults</CapLabel>
        <Row label="Autonomy" value={s.autonomy === 'review' ? 'Review each' : 'Auto-run (draft PRs)'} onPress={() => setPicker('autonomy')} accent />
        <Row label="Task budget" value={`$${s.taskBudgetUsd} / task`} onPress={() => { setBudgetInput(String(s.taskBudgetUsd)); setPicker('budget'); }} accent />

        <CapLabel style={styles.head}>Account</CapLabel>
        <Row label="GitHub" value={github.active ? `@${github.active}` : 'not connected'} onPress={() => setPicker('github')} accent />
      </ScrollView>

      {/* Digest time picker */}
      <PickerModal visible={picker === 'digest'} title="Digest time" onClose={() => setPicker(null)}
        options={DIGEST_TIMES.map((t) => ({ value: t, label: fmtTime(t) }))}
        onSelect={(v) => save({ digestTime: v })} />

      {/* Autonomy picker */}
      <PickerModal visible={picker === 'autonomy'} title="Autonomy" onClose={() => setPicker(null)}
        options={[
          { value: 'auto', label: 'Auto-run (draft PRs) — recommended' },
          { value: 'review', label: 'Review each — confirm before running' },
        ]}
        onSelect={(v) => save({ autonomy: v })} />

      {/* Budget picker with custom input */}
      <Modal visible={picker === 'budget'} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Max $ per task</Text>
            <View style={styles.budgetRow}>
              {BUDGETS.map((b) => (
                <Pressable key={b} style={styles.budgetChip} onPress={() => { save({ taskBudgetUsd: b }); setPicker(null); }}>
                  <Text style={styles.budgetChipTxt}>${b}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.budgetInput} placeholder="custom $" placeholderTextColor={C.muted}
              keyboardType="numeric" value={budgetInput} onChangeText={setBudgetInput} />
            <Pressable style={styles.saveBtn} onPress={() => { const n = parseFloat(budgetInput); if (n > 0) save({ taskBudgetUsd: n }); setPicker(null); }}>
              <Text style={styles.saveBtnTxt}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* GitHub account management */}
      <Modal visible={picker === 'github'} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>GitHub accounts</Text>
            {github.accounts.length === 0 && <Text style={styles.hint}>No accounts reported by the runner.</Text>}
            {github.accounts.map((a) => (
              <View key={a} style={styles.ghRow}>
                <Text style={[styles.optTxt, { flex: 1 }]}>@{a}{a === github.active ? '  ·  active' : ''}</Text>
                {a !== github.active && <Pressable onPress={() => { switchAccount(a); setPicker(null); }}><Text style={[styles.action, { color: C.accent }]}>Use</Text></Pressable>}
                <Pressable onPress={() => { logoutAccount(a); setPicker(null); }}><Text style={[styles.action, { color: C.blocked, marginLeft: 14 }]}>Disconnect</Text></Pressable>
              </View>
            ))}
            <Text style={[styles.hint, { marginTop: 12 }]}>
              To connect a different account, run{'\n'}<Text style={{ color: C.text }}>gh auth login</Text>{'\n'}on your laptop, then it appears here.
            </Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  head: { marginTop: 18, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  rowLabel: { flex: 1, fontSize: 14, color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  rowVal: { fontSize: 14, color: C.text2 },
  action: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 18 },
  pairCode: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: 4, textAlign: 'center' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.muted, marginRight: 11, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.ready },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ready },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: C.border },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 },
  opt: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  optTxt: { fontSize: 15, color: C.text },
  ghRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  budgetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  budgetChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  budgetChipTxt: { color: C.text, fontWeight: '700', fontSize: 15 },
  budgetInput: { height: 48, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, color: C.text, fontSize: 15, marginBottom: 10 },
  saveBtn: { height: 48, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
