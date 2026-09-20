// One place for colour and type. Components read the palette through useTheme(); they never
// import a colour directly, so the whole app re-skins when the scheme changes.
//
// Colour rules for this project:
//  • no red-versus-green distinction anywhere; red is not used as a status colour
//  • colour is never the only channel — every status badge carries a glyph and a label,
//    and no copy ever refers to a colour ("the amber block") to identify something
//  • every palette is machine-checked before it ships (scripts/palette-check.py, also run in CI):
//    contrast ≥ 4.5:1 on every text/background pair the UI renders, and the four status hues
//    ≥ 16 ΔE apart under protan, deutan and tritan simulation (Machado 2009). Slate is
//    deliberately a warm grey so it stays apart from teal for protan viewers.
//
// Adding a scheme later (a user-chosen one, a brand one) means adding an entry to `palettes`
// and running the same check; nothing else changes.
import type { EventKind, Role } from '../model/types';
import type { Suggestion } from '../concierge/rules';

export type Palette = {
  bg: string;
  panel: string;
  panelAlt: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  indigo: string;
  indigoSoft: string;
  amber: string;
  amberSoft: string;
  teal: string;
  tealSoft: string;
  slate: string;
  slateSoft: string;
};

export type SchemeName = 'light' | 'dark';

export const palettes: Record<SchemeName, Palette> = {
  light: {
    bg: '#F6F5F1',
    panel: '#FFFFFF',
    panelAlt: '#EFEDE7',
    ink: '#1B1F24',
    ink2: '#4B5259',
    ink3: '#5F6973',
    line: '#DDD9D0',
    accent: '#2E4A7A',
    accentSoft: '#E6ECF5',
    onAccent: '#FFFFFF',
    indigo: '#48239F',
    indigoSoft: '#EEEBFA',
    amber: '#853E08',
    amberSoft: '#FDF3E4',
    teal: '#075871',
    tealSoft: '#E6F3F8',
    slate: '#594F47',
    slateSoft: '#F1F3F5',
  },
  dark: {
    bg: '#14171B',
    panel: '#1D2126',
    panelAlt: '#272C33',
    ink: '#ECEEF1',
    ink2: '#B9C0C8',
    ink3: '#98A1AA',
    line: '#353C45',
    accent: '#9DB6E6',
    accentSoft: '#25334D',
    onAccent: '#0F1520',
    indigo: '#A0ABFF',
    indigoSoft: '#2B2752',
    amber: '#E9AB55',
    amberSoft: '#3E2D12',
    teal: '#77CDE0',
    tealSoft: '#12363C',
    slate: '#BDB7A2',
    slateSoft: '#2C3339',
  },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
export const type = {
  h1: { fontSize: 26, fontWeight: '700' as const, lineHeight: 32 },
  h2: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  mono: { fontFamily: 'Menlo', fontSize: 13 },
};

export type Tone = { fg: string; bg: string; glyph: string; label: string };

/** Every coloured badge in the app, derived from one palette so they re-theme together. */
export type Tones = ReturnType<typeof makeTones>;
export function makeTones(p: Palette) {
  const severity: Record<Suggestion['severity'], Tone> = {
    urgent: { fg: p.indigo, bg: p.indigoSoft, glyph: '◆', label: 'Urgent' },
    attention: { fg: p.amber, bg: p.amberSoft, glyph: '▲', label: 'Needs attention' },
    info: { fg: p.teal, bg: p.tealSoft, glyph: '●', label: 'For your information' },
  };
  /** Audience badges: `shared` carries the names ("Shared with Dana, Sam"); `team` never reaches a homeowner. */
  const audience: Record<'shared' | 'team', Tone> = {
    shared: { fg: p.teal, bg: p.tealSoft, glyph: '◎', label: 'Shared' },
    team: { fg: p.amber, bg: p.amberSoft, glyph: '◈', label: 'Your business only' },
  };
  /** Who buys an item. Shown on every item row so the homeowner knows what is theirs to source. */
  const purchaser: Record<'contractor' | 'homeowner', Tone> = {
    contractor: { fg: p.slate, bg: p.slateSoft, glyph: '⚒', label: 'Contractor supplies' },
    homeowner: { fg: p.indigo, bg: p.indigoSoft, glyph: '⌂', label: 'Homeowner buys' },
  };
  const role: Record<Role, Tone> = {
    contractor: { fg: p.accent, bg: p.accentSoft, glyph: '⚒', label: 'Contractor' },
    homeowner: { fg: p.indigo, bg: p.indigoSoft, glyph: '⌂', label: 'Homeowner' },
  };
  const itemStatus: Record<
    'proposed' | 'approved' | 'ordered' | 'delivered' | 'installed' | 'changes_requested',
    Tone
  > = {
    proposed: { fg: p.slate, bg: p.slateSoft, glyph: '○', label: 'Proposed' },
    changes_requested: { fg: p.amber, bg: p.amberSoft, glyph: '↺', label: 'Change requested' },
    approved: { fg: p.teal, bg: p.tealSoft, glyph: '✓', label: 'Approved' },
    ordered: { fg: p.amber, bg: p.amberSoft, glyph: '⇢', label: 'Ordered' },
    delivered: { fg: p.indigo, bg: p.indigoSoft, glyph: '▣', label: 'Delivered' },
    installed: { fg: p.accent, bg: p.accentSoft, glyph: '◆', label: 'Installed' },
  };
  return { severity, audience, purchaser, role, itemStatus };
}

/** Glyph and label per entry kind. No colour: kinds are told apart by shape and word only. */
export const kindGlyph: Record<EventKind, { glyph: string; label: string }> = {
  note: { glyph: '✎', label: 'Note' },
  milestone: { glyph: '⚑', label: 'Milestone' },
  schedule: { glyph: '◷', label: 'Scheduled' },
  order: { glyph: '⇢', label: 'Ordered' },
  delivery: { glyph: '▣', label: 'Delivery' },
  approval_requested: { glyph: '?', label: 'Approval needed' },
  approval_decided: { glyph: '✓', label: 'Decision' },
  photo: { glyph: '▧', label: 'Photo' },
  document_sent: { glyph: '⇪', label: 'Document sent' },
  dismissal: { glyph: '⊘', label: 'Concierge' },
};
