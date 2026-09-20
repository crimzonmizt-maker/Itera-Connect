// Fictional sample project used when no Supabase configuration is present.
// Names, prices and part numbers are made up.
import { addDays } from '../model/format';
import type { Id, Item, Project, ProjectEvent, ProjectMember } from '../model/types';

export const NOW = '2026-09-19T17:00:00.000Z';
const d = (days: number) => addDays(NOW, days);

export const CONTRACTOR = {
  userId: 'user-mike',
  displayName: 'Mike Alvarez',
  businessId: 'biz-alvarez',
};
export const HOMEOWNER = { userId: 'user-dana', displayName: 'Dana Whitfield' };
export const HOMEOWNER_2 = { userId: 'user-sam', displayName: 'Sam Whitfield' };

/** A hybrid job: Mike supplies the vanity and glass; Dana is buying the tile and grout herself. */
export const sampleProject: Project = {
  id: 'proj-whitfield-bath',
  businessId: CONTRACTOR.businessId,
  name: 'Whitfield primary bath',
  address: '418 Larkspur Ct',
  homeownerName: HOMEOWNER.displayName,
  mode: 'hybrid',
  showPrices: true,
  startDate: d(-21),
  targetDate: d(35),
  createdAt: d(-24),
};

export const sampleMembers: ProjectMember[] = [
  {
    projectId: sampleProject.id,
    userId: CONTRACTOR.userId,
    role: 'contractor',
    displayName: CONTRACTOR.displayName,
    email: 'mike@example.test',
  },
  {
    projectId: sampleProject.id,
    userId: HOMEOWNER.userId,
    role: 'homeowner',
    displayName: HOMEOWNER.displayName,
    email: 'dana@example.test',
  },
  {
    projectId: sampleProject.id,
    userId: HOMEOWNER_2.userId,
    role: 'homeowner',
    displayName: HOMEOWNER_2.displayName,
    email: 'sam@example.test',
  },
];

const BOTH: Id[] = [HOMEOWNER.userId, HOMEOWNER_2.userId];
const DANA: Id[] = [HOMEOWNER.userId];
const TEAM: Id[] = [];

export const sampleItems: Item[] = [
  {
    id: 'item-vanity',
    projectId: sampleProject.id,
    name: 'Cape Breton 48" vanity, white oak',
    room: 'Primary bath',
    quantity: 1,
    unit: 'each',
    status: 'ordered',
    purchasedBy: 'contractor',
    clientPrice: 184000,
    sourcing: {
      supplier: 'Northline Cabinetry',
      sku: 'CB-48-WO',
      orderNumber: 'NL-77812',
      leadTimeDays: 42,
    },
    team: {
      supplierCost: 126500,
      note: 'Client dislikes brushed nickel — confirm pulls are matte black before install.',
    },
  },
  {
    id: 'item-floor-tile',
    projectId: sampleProject.id,
    name: 'Hanoi 12×24 porcelain floor tile',
    room: 'Primary bath',
    quantity: 14,
    unit: 'box',
    status: 'delivered',
    purchasedBy: 'homeowner',
    clientPrice: 98000,
    sourcing: {
      supplier: 'Emser Tile',
      sku: 'HAN-1224-GR',
      orderNumber: 'SO-118842',
      leadTimeDays: 10,
    },
    team: {
      note: 'Dana ordered this herself from the Emser showroom; we only receive and install.',
    },
  },
  {
    id: 'item-shower-glass',
    projectId: sampleProject.id,
    name: 'Frameless shower enclosure, 60"',
    room: 'Primary bath',
    quantity: 1,
    unit: 'each',
    status: 'proposed',
    purchasedBy: 'contractor',
    clientPrice: 245000,
    sourcing: { supplier: 'ClearLine Glass', leadTimeDays: 21 },
    team: { supplierCost: 178000 },
  },
  {
    id: 'item-grout',
    projectId: sampleProject.id,
    name: 'Grout — Warm Gray, sanded',
    room: 'Primary bath',
    quantity: 3,
    unit: 'bag',
    status: 'proposed',
    purchasedBy: 'homeowner',
    clientPrice: 6600,
    sourcing: { supplier: 'Emser Tile', sku: 'GR-WG-25', leadTimeDays: 3 },
  },
];

const base = (id: string, at: string, author: 'c' | 'h', audience: Id[]) => ({
  id,
  projectId: sampleProject.id,
  at,
  audience,
  replies: [],
  authorId: author === 'c' ? CONTRACTOR.userId : HOMEOWNER.userId,
  authorName: author === 'c' ? CONTRACTOR.displayName : HOMEOWNER.displayName,
  authorRole: (author === 'c' ? 'contractor' : 'homeowner') as 'contractor' | 'homeowner',
});

export const sampleEvents: ProjectEvent[] = [
  { ...base('ev-01', d(-21), 'c', BOTH), kind: 'milestone', title: 'Demolition', status: 'done' },
  {
    ...base('ev-02', d(-21), 'c', BOTH),
    kind: 'milestone',
    title: 'Rough plumbing & electrical',
    status: 'planned',
  },
  {
    ...base('ev-03', d(-21), 'c', BOTH),
    kind: 'milestone',
    title: 'Tile floor & walls',
    status: 'planned',
  },
  {
    ...base('ev-04', d(-21), 'c', BOTH),
    kind: 'milestone',
    title: 'Vanity & fixtures',
    status: 'planned',
  },
  {
    ...base('ev-05', d(-21), 'c', BOTH),
    kind: 'milestone',
    title: 'Shower glass',
    status: 'planned',
  },
  {
    ...base('ev-06', d(-21), 'c', BOTH),
    kind: 'milestone',
    title: 'Punch list & handover',
    status: 'planned',
  },
  {
    ...base('ev-07', d(-19), 'c', BOTH),
    kind: 'document_sent',
    title: 'Floor plan — layout only',
    layers: ['layout'],
    via: 'email',
    to: 'dana@example.test',
    body: 'Sent the layout without dimensions or fixtures so we can agree the footprint first.',
  },
  {
    ...base('ev-08', d(-18), 'c', BOTH),
    kind: 'order',
    itemId: 'item-vanity',
    expectedDate: d(24),
    refs: [{ kind: 'item', id: 'item-vanity', label: 'Cape Breton 48" vanity, white oak' }],
  },
  {
    ...base('ev-09', d(-18), 'c', TEAM),
    kind: 'note',
    body: 'Northline quoted 6 weeks; told Dana “about a month”. Watch this one.',
  },
  {
    ...base('ev-10', d(-14), 'c', BOTH),
    kind: 'milestone',
    title: 'Rough plumbing & electrical',
    status: 'started',
  },
  {
    ...base('ev-11', d(-12), 'c', BOTH),
    kind: 'order',
    itemId: 'item-floor-tile',
    expectedDate: d(-2),
    body: 'Dana placed the order at Emser; delivery to the house.',
  },
  {
    ...base('ev-12', d(-9), 'c', DANA),
    kind: 'approval_requested',
    approvalId: 'appr-grout',
    title: 'Grout colour for the floor tile: Warm Gray vs. Bright White',
    dueBy: d(-1),
    amount: 6600,
    itemId: 'item-grout',
    body: 'For the joints in the Hanoi floor tile (primary bath floor). Warm Gray hides dirt better on a floor; Bright White matches the wall tile. Tiler needs a decision before he starts. You are buying this one — SKU is on the item.',
  },
  {
    ...base('ev-13', d(-7), 'c', BOTH),
    kind: 'milestone',
    title: 'Rough plumbing & electrical',
    status: 'done',
  },
  {
    ...base('ev-14', d(-6), 'c', BOTH),
    kind: 'photo',
    uri: 'sample://rough-in',
    caption: 'Rough-in inspection passed',
  },
  {
    ...base('ev-15', d(-5), 'c', BOTH),
    kind: 'schedule',
    title: 'Tile install',
    date: d(3),
    who: 'Luis (tiler)',
    needs: ['item-floor-tile', 'item-grout'],
    refs: [
      { kind: 'item', id: 'item-floor-tile', label: 'Hanoi 12×24 porcelain floor tile' },
      { kind: 'item', id: 'item-grout', label: 'Grout — Warm Gray, sanded' },
    ],
  },
  {
    ...base('ev-16', d(-2), 'c', TEAM),
    kind: 'delivery',
    itemId: 'item-floor-tile',
    expected: 14,
    received: 12,
    damaged: 1,
    body: 'Two boxes short, one box cracked. Called Emser on Dana’s order, replacement promised.',
  },
  {
    ...base('ev-17', d(-2), 'h', BOTH),
    kind: 'note',
    body: 'Saw the tile pallet on the driveway — looks great! Is everything on track for next week?',
    replies: [
      {
        id: 'rp-01',
        at: d(-2),
        authorId: CONTRACTOR.userId,
        authorName: CONTRACTOR.displayName,
        authorRole: 'contractor',
        body: 'Yes — tiler starts Tuesday. I just need your grout decision.',
      },
    ],
  },
  {
    ...base('ev-18', d(-1), 'c', BOTH),
    kind: 'schedule',
    title: 'Vanity & fixture install',
    date: d(18),
    who: 'Mike',
    needs: ['item-vanity'],
    refs: [{ kind: 'item', id: 'item-vanity', label: 'Cape Breton 48" vanity, white oak' }],
  },
  {
    ...base('ev-19', d(0), 'c', BOTH),
    kind: 'approval_requested',
    approvalId: 'appr-glass',
    title: 'Frameless shower enclosure, 60"',
    dueBy: d(7),
    amount: 245000,
    itemId: 'item-shower-glass',
    body: 'ClearLine needs 3 weeks. Approving now keeps the glass on schedule for the last week.',
  },
];
