import type { Id, IsoDate, ProjectEvent } from './types';

export type Milestone = {
  title: string;
  status: 'planned' | 'started' | 'done';
  due?: IsoDate;
  updatedAt: IsoDate;
};

export type Progress = {
  milestones: Milestone[];
  done: number;
  total: number;
  percent: number; // 0–100, whole number
  current?: Milestone; // the first milestone that is started, else the first planned one
};

/** Latest status per milestone title wins. Events are already in time order. */
export function projectProgress(events: ProjectEvent[]): Progress {
  const byTitle = new Map<string, Milestone>();
  for (const event of events) {
    if (event.kind !== 'milestone') continue;
    byTitle.set(event.title, {
      title: event.title,
      status: event.status,
      due: event.due ?? byTitle.get(event.title)?.due,
      updatedAt: event.at,
    });
  }
  const milestones = [...byTitle.values()];
  const done = milestones.filter((m) => m.status === 'done').length;
  const total = milestones.length;
  return {
    milestones,
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    current:
      milestones.find((m) => m.status === 'started') ??
      milestones.find((m) => m.status === 'planned'),
  };
}

export type Approval = {
  approvalId: Id;
  requestedEventId: Id;
  title: string;
  requestedAt: IsoDate;
  dueBy?: IsoDate;
  amount?: number;
  itemId?: Id;
  /** Latest decision on the latest request. Undefined = still waiting on the homeowner. */
  decision?: 'approved' | 'changes_requested';
  decidedAt?: IsoDate;
  decidedBy?: string;
  decidedEventId?: Id;
  decisionNote?: string;
  /** How many times the contractor has (re)requested this. 1 = first ask. */
  round: number;
};

/**
 * pending            — waiting on the homeowner
 * changes_requested  — the homeowner answered "change it"; waiting on the contractor to revise
 *                      and request again (a new approval_requested with the same approvalId)
 * approved           — done
 */
export type ApprovalState = 'pending' | 'changes_requested' | 'approved';
export const approvalState = (a: Approval): ApprovalState => a.decision ?? 'pending';

/** Approvals are not stored; they are read off the request/decision pairs in the event list. */
export function approvals(events: ProjectEvent[]): Approval[] {
  const map = new Map<Id, Approval>();
  for (const event of events) {
    if (event.kind === 'approval_requested') {
      // A repeat request (same approvalId) is the contractor's revised proposal: the earlier
      // decision no longer applies and the homeowner is asked again.
      const prev = map.get(event.approvalId);
      map.set(event.approvalId, {
        approvalId: event.approvalId,
        requestedEventId: event.id,
        title: event.title,
        requestedAt: event.at,
        dueBy: event.dueBy,
        amount: event.amount,
        itemId: event.itemId,
        round: (prev?.round ?? 0) + 1,
      });
    } else if (event.kind === 'approval_decided') {
      const existing = map.get(event.approvalId);
      if (existing) {
        existing.decision = event.decision;
        existing.decidedAt = event.at;
        existing.decidedBy = event.authorName;
        existing.decidedEventId = event.id;
        existing.decisionNote = event.body;
      }
    }
  }
  return [...map.values()];
}

/** Everything not yet approved: waiting on the homeowner, or on the contractor to revise. */
export const openApprovals = (events: ProjectEvent[]) =>
  approvals(events).filter((a) => a.decision !== 'approved');
