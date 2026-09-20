// The shared project record. One truth, two audiences.
//
// Every entry on the timeline names WHO may see it beyond the contractor's team — an
// `audience` of member ids. Every item knows WHO IS BUYING it, and that — together with the
// project's engagement mode — decides which of its fields the homeowner sees.
// Screens never decide what to hide; they render what the repository returns, and the
// repository (local or Supabase row-level security) does the filtering.

export type Id = string;
export type IsoDate = string; // "2026-09-19T14:00:00.000Z"
export type Money = number; // whole cents. $1,840.00 is 184000. Never a float.

export type Role = 'contractor' | 'homeowner';

/**
 * How the contractor is engaged on this project. Sets the defaults for who buys materials
 * and whether the homeowner sees prices. The contractor can override per item.
 *   all_in     — contractor supplies everything; homeowner pays one price
 *   labor_only — contractor supplies labor; homeowner buys the materials
 *   hybrid     — decided item by item (most real jobs end up here)
 */
export type EngagementMode = 'all_in' | 'labor_only' | 'hybrid';
export type Purchaser = 'contractor' | 'homeowner';

export type Business = {
  id: Id;
  name: string;
  ownerUserId: Id;
};

export type Project = {
  id: Id;
  businessId: Id;
  name: string;
  address: string;
  homeownerName?: string;
  mode: EngagementMode;
  /** Whether homeowners see client prices on contractor-purchased items. Mode sets the default. */
  showPrices: boolean;
  startDate?: IsoDate;
  targetDate?: IsoDate;
  createdAt: IsoDate;
};

export type ProjectMember = {
  projectId: Id;
  userId: Id;
  role: Role;
  displayName: string;
  email?: string;
};

export type Invitation = {
  id: Id;
  projectId: Id;
  email: string;
  code: string; // what the homeowner types in; 8 characters, no ambiguous letters
  role: 'homeowner';
  createdAt: IsoDate;
  expiresAt: IsoDate;
  acceptedAt?: IsoDate;
};

/**
 * A selection or product on the project.
 *   clientPrice — what the homeowner pays. Present for homeowners when the project shows
 *                 prices, the item is theirs to buy, or the contractor shared it.
 *   sourcing    — supplier, SKU, order number, lead time. Present for homeowners when THEY
 *                 are buying the item (they need it) or the contractor shared it.
 *   team        — supplier cost and internal notes. Never leaves the contractor's side.
 */
export type Item = {
  id: Id;
  projectId: Id;
  name: string;
  room?: string;
  quantity: number;
  unit?: string; // "each", "box", "sq ft"
  /** changes_requested: the homeowner asked for a change; the contractor revises and re-requests. */
  status: ItemStatus;
  purchasedBy: Purchaser;
  clientPrice?: Money;
  sourcing?: ItemSourcing;
  team?: ItemTeamFields;
  /** Contractor overrides of the mode defaults, per item. */
  sharePrice?: boolean;
  shareSourcing?: boolean;
};

export type ItemStatus =
  'proposed' | 'changes_requested' | 'approved' | 'ordered' | 'delivered' | 'installed';

export type ItemSourcing = {
  supplier?: string;
  sku?: string;
  orderNumber?: string;
  leadTimeDays?: number;
};

export type ItemTeamFields = {
  supplierCost?: Money;
  note?: string;
};

export type Reply = {
  id: Id;
  at: IsoDate;
  authorId: Id;
  authorName: string;
  authorRole: Role;
  body: string;
};

type EventBase = {
  id: Id;
  projectId: Id;
  at: IsoDate;
  authorId: Id;
  authorName: string;
  authorRole: Role;
  /**
   * Member ids who may see this entry in addition to the contractor's team.
   * Empty = the contractor's business only. The badge shows their names: "Shared with Dana, Sam".
   */
  audience: Id[];
  body?: string;
  /**
   * Things this entry is about, so the reader can jump to them: the item a reminder concerns,
   * the job a digest line mentions. Every reference in the app is a link, never plain text.
   */
  refs?: Ref[];
  replies: Reply[];
};

export type Ref = { kind: 'item' | 'event'; id: Id; label: string };

/**
 * The spine of a project. Everything that happens is one of these, appended in order.
 * Pages are views over this list; there is no separate message board, task list or inbox.
 */
export type ProjectEvent = EventBase &
  (
    | { kind: 'note' }
    | { kind: 'milestone'; title: string; status: 'planned' | 'started' | 'done'; due?: IsoDate }
    | { kind: 'schedule'; title: string; date: IsoDate; who?: string; needs?: Id[] }
    | { kind: 'order'; itemId: Id; expectedDate?: IsoDate }
    | { kind: 'delivery'; itemId: Id; expected: number; received: number; damaged: number }
    | {
        kind: 'approval_requested';
        approvalId: Id;
        title: string;
        dueBy?: IsoDate;
        amount?: Money;
        itemId?: Id;
      }
    | {
        kind: 'approval_decided';
        approvalId: Id;
        decision: 'approved' | 'changes_requested';
      }
    | { kind: 'photo'; uri: string; caption?: string }
    /**
     * A document left the app — a floor plan PDF e-mailed with chosen layers, a quote printed.
     * The app does not store the file; it records that it went, to whom, and what was in it.
     */
    | {
        kind: 'document_sent';
        title: string;
        layers: string[]; // e.g. ["layout"] or ["layout","dimensions","fixtures"]
        via: 'email' | 'print' | 'other';
        to: string; // e-mail address or a name
      }
    /**
     * The contractor dealt with a concierge suggestion: set it aside, brought it back, or acted
     * on it. Always business-only. Nothing is ever deleted — "I dismissed that on the 15th" is
     * on the record, and an urgent item that was dismissed comes back until it is resolved.
     */
    | {
        kind: 'dismissal';
        suggestionId: string;
        title: string;
        severity: 'info' | 'attention' | 'urgent';
        action: 'dismiss' | 'restore' | 'acted';
        /** When the suggestion may show again if still open. Absent = not until restored. */
        until?: IsoDate;
        reason?: string;
      }
  );

export type EventKind = ProjectEvent['kind'];

/** What a caller supplies to append an event; the repository fills in id, at, author and replies. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<
  ProjectEvent,
  'id' | 'at' | 'authorId' | 'authorName' | 'authorRole' | 'replies'
>;

export type Viewer = {
  userId: Id;
  displayName: string;
  role: Role;
  businessId?: Id; // set for contractors
};
