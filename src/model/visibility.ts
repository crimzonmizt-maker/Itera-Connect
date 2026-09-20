import type {
  EngagementMode,
  EventKind,
  Id,
  Item,
  Project,
  ProjectEvent,
  ProjectMember,
  Purchaser,
  Viewer,
} from './types';

// ───────────────────────────── events: who may see an entry ─────────────────────────────

/** Contractors see everything on their own projects. Anyone else must be in the audience. */
export function canSee(
  viewer: Pick<Viewer, 'role' | 'userId'>,
  event: Pick<ProjectEvent, 'audience'>,
): boolean {
  return viewer.role === 'contractor' || event.audience.includes(viewer.userId);
}

export function visibleEvents(
  viewer: Pick<Viewer, 'role' | 'userId'>,
  events: ProjectEvent[],
): ProjectEvent[] {
  return events.filter((event) => canSee(viewer, event));
}

/** Team-only entries have nobody in the audience. */
export const isTeamOnly = (event: Pick<ProjectEvent, 'audience'>) => event.audience.length === 0;

/** The homeowner members of a project — the usual audience for a shared entry. */
export const homeownerIds = (members: ProjectMember[]): Id[] =>
  members.filter((m) => m.role === 'homeowner').map((m) => m.userId);

/**
 * Sensible default audience by entry type. The contractor can change it per entry.
 * Deliveries and plain notes default to the business only: shortfalls and margins are the
 * contractor's problem to resolve before they become the homeowner's worry.
 */
export function defaultAudience(kind: EventKind, members: ProjectMember[]): Id[] {
  switch (kind) {
    case 'note':
    case 'delivery':
    case 'dismissal':
      return [];
    case 'milestone':
    case 'schedule':
    case 'order':
    case 'approval_requested':
    case 'approval_decided':
    case 'photo':
    case 'document_sent':
      return homeownerIds(members);
  }
}

/** "Shared with Dana, Sam" / "Your business only" — for badges. Never names a colour. */
export function audienceLabel(audience: Id[], members: ProjectMember[]): string {
  if (audience.length === 0) return 'Your business only';
  const names = audience
    .map((id) => members.find((m) => m.userId === id)?.displayName.split(' ')[0] ?? 'guest')
    .filter(Boolean);
  return `Shared with ${names.join(', ')}`;
}

// ───────────────────────────── items: what the buyer decides ─────────────────────────────

/** Mode defaults: who buys, and whether prices show on contractor-purchased items. */
export function modeDefaults(mode: EngagementMode): {
  purchasedBy: Purchaser;
  showPrices: boolean;
} {
  switch (mode) {
    case 'all_in':
      return { purchasedBy: 'contractor', showPrices: false }; // contractor's markup stays private
    case 'labor_only':
      return { purchasedBy: 'homeowner', showPrices: true };
    case 'hybrid':
      return { purchasedBy: 'contractor', showPrices: true };
  }
}

export function priceVisibleToHomeowner(project: Pick<Project, 'showPrices'>, item: Item): boolean {
  if (item.sharePrice !== undefined) return item.sharePrice;
  return item.purchasedBy === 'homeowner' || project.showPrices;
}

export function sourcingVisibleToHomeowner(item: Item): boolean {
  if (item.shareSourcing !== undefined) return item.shareSourcing;
  return item.purchasedBy === 'homeowner'; // they have to go and buy it
}

/** The homeowner's copy of an item. Team fields never survive; price and sourcing depend on the buyer. */
export function redactItem(
  role: 'contractor' | 'homeowner',
  project: Pick<Project, 'showPrices'>,
  item: Item,
): Item {
  if (role === 'contractor') return item;
  const { team: _team, sharePrice: _sp, shareSourcing: _ss, ...rest } = item;
  return {
    ...rest,
    clientPrice: priceVisibleToHomeowner(project, item) ? item.clientPrice : undefined,
    sourcing: sourcingVisibleToHomeowner(item) ? item.sourcing : undefined,
  };
}

export function redactItems(
  role: 'contractor' | 'homeowner',
  project: Pick<Project, 'showPrices'>,
  items: Item[],
): Item[] {
  return items.map((item) => redactItem(role, project, item));
}
