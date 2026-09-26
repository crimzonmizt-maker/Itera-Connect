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

/**
 * A room on the project. The contractor names it however they like ("Jack and Jill upstairs",
 * "the back room"); `type` is what the app uses to look things up — later, a contractor's
 * usual materials for a bathroom. A guessed type is a guess until the contractor confirms it,
 * and the app never acts on a guess without asking.
 */
export type RoomType =
  | 'bathroom'
  | 'kitchen'
  | 'bedroom'
  | 'living'
  | 'laundry'
  | 'basement'
  | 'garage'
  | 'exterior'
  | 'other';

export type Room = {
  id: Id;
  projectId: Id;
  name: string;
  type?: RoomType;
  /** True once the contractor chose or confirmed the type; false while it is only guessed from the name. */
  typeConfirmed: boolean;
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
  /** The room this item belongs to. Optional: a permit or a dumpster is not in a room. */
  roomId?: Id;
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

/**
 * How a request for approval was answered.
 *   approved           — the homeowner said yes
 *   changes_requested  — the homeowner said "change it" and why; the contractor's move
 *   withdrawn          — the contractor took the question back (dropping the item, or starting
 *                        over with a different one); only the contractor can post this
 */
export type Decision = 'approved' | 'changes_requested' | 'withdrawn';

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
  /** Files that travel with the entry. Same audience as the entry. */
  attachments?: Attachment[];
  replies: Reply[];
};

export type Ref = { kind: 'item' | 'event'; id: Id; label: string };

/**
 * A file on the record: a photo, a PDF spec sheet, a drawing. `path` is where the backend keeps
 * it (Supabase: "<project id>/<random>/<name>" in the private ic-files bucket). Who may open it
 * follows the entry it is attached to — the database checks that, not the screen.
 */
export type Attachment = { path: string; name: string; mimeType: string; size?: number };

/**
 * The spine of a project. Everything that happens is one of these, appended in order.
 * Pages are views over this list; there is no separate message board, task list or inbox.
 */
export type ProjectEvent = EventBase &
  (
    | { kind: 'note' }
    | {
        kind: 'milestone';
        title: string;
        /** 'update' is a progress note: it leaves the milestone where it is. */
        status: 'planned' | 'started' | 'update' | 'done';
        due?: IsoDate;
      }
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
        decision: Decision;
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
        /** For a snooze: what was picked, and whether the contractor confirmed it cut close to the deadline. */
        snooze?: { hours?: number; days?: number; cutsClose: boolean };
      }
  );

export type EventKind = ProjectEvent['kind'];

/** What a caller supplies to append an event; the repository fills in id, at, author and replies. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<
  ProjectEvent,
  'id' | 'at' | 'authorId' | 'authorName' | 'authorRole' | 'replies'
>;

export type Plan = 'free' | 'pro';

/** The account's plan and what it allows. projectLimit null = no limit. */
export type Account = { plan: Plan; projectLimit: number | null };

export type Viewer = {
  userId: Id;
  displayName: string;
  /**
   * The role this person has by default: contractor if they run a business. On a given project
   * the role can differ (a contractor invited to someone else's job is a homeowner there);
   * `roleOn` decides that.
   */
  role: Role;
  businessId?: Id; // set for contractors
  account?: Account;
};

/** The role a viewer has on one project: team if the project belongs to their business. */
export function roleOn(viewer: Viewer, project: Pick<Project, 'businessId'> | undefined): Role {
  if (!project || viewer.businessId === undefined) return viewer.role;
  return project.businessId === viewer.businessId ? 'contractor' : 'homeowner';
}
