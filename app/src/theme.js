// Dispatch design tokens — dark theme matching dispatch-mockup.html
export const C = {
  canvas: '#0E0F13',
  surface: '#191B21',
  surface2: '#23262E',
  surface3: '#2A2E37',
  border: '#2E323B',
  text: '#F4F5F7',
  text2: '#9CA3AF',
  muted: '#6B7280',
  accent: '#3B82F6',
  accentSoft: 'rgba(59,130,246,0.16)',
  // status
  queued: '#6B7280',
  running: '#4C9AFF',
  needsyou: '#F5A623',
  ready: '#30D158',
  blocked: '#FF453A',
};

// Map backend task state -> a status "bucket" used for dots/glyphs/grouping.
// States: CAPTURED, SPEC_DRAFTED, SPEC_CONFIRMED, RUNNING, TESTS, PR_OPEN,
//         AWAITING_REVIEW, NEEDS_INPUT, BLOCKED, FAILED, HELD, MERGED, DISCARDED
export function statusOf(state) {
  switch (state) {
    case 'NEEDS_INPUT':
    case 'SPEC_DRAFTED':
      return 'needsyou';
    case 'RUNNING':
    case 'TESTS':
    case 'SPEC_CONFIRMED':
      return 'running';
    case 'PR_OPEN':
    case 'AWAITING_REVIEW':
    case 'MERGED':
    case 'ANSWERED':
      return 'ready';
    case 'BLOCKED':
    case 'FAILED':
      return 'blocked';
    case 'CAPTURED':
    case 'HELD':
    case 'DISCARDED':
    default:
      return 'queued';
  }
}

export const STATUS_COLOR = {
  queued: C.queued,
  running: C.running,
  needsyou: C.needsyou,
  ready: C.ready,
  blocked: C.blocked,
};

export const STATUS_GLYPH = {
  queued: '•',
  running: '●',
  needsyou: '⚠',
  ready: '✓',
  blocked: '✕',
};

// Human label for a raw backend state
export function stateLabel(state) {
  const map = {
    CAPTURED: 'captured',
    SPEC_DRAFTED: 'needs your OK',
    SPEC_CONFIRMED: 'confirmed',
    RUNNING: 'running',
    TESTS: 'running tests',
    PR_OPEN: 'PR ready',
    ANSWERED: 'answered',
    AWAITING_REVIEW: 'ready to review',
    NEEDS_INPUT: 'needs you',
    BLOCKED: 'blocked',
    FAILED: 'failed',
    HELD: 'held',
    MERGED: 'merged',
    DISCARDED: 'discarded',
  };
  return map[state] || String(state || '').toLowerCase();
}
