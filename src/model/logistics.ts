// Where each item is on its way from supplier to site, read off the event spine.
// Shared by the concierge (to warn) and the item cards (to show "expected Oct 13"),
// so the number the homeowner sees is the same number the warning was computed from.
import { addDays, daysBetween } from './format';
import type { Id, IsoDate, Item, ProjectEvent } from './types';

export type Arrival =
  | { state: 'not_ordered' }
  | { state: 'ordered'; orderedAt: IsoDate; expected?: IsoDate; eventId: Id }
  | {
      state: 'delivered';
      at: IsoDate;
      received: number;
      expected: number;
      damaged: number;
      eventId: Id;
    }
  | {
      state: 'short';
      at: IsoDate;
      received: number;
      expected: number;
      damaged: number;
      eventId: Id;
    };

/**
 * Latest known position of one item. Expected date = the order's expectedDate, else order
 * date + the item's lead time. A delivery that made the item whole is 'delivered'; one that did
 * not is 'short' (usable = received − damaged).
 */
export function arrivalOf(item: Item, events: ProjectEvent[]): Arrival {
  let arrival: Arrival = { state: 'not_ordered' };
  let totals = { expected: 0, received: 0, damaged: 0 };
  for (const e of events) {
    if (e.kind === 'order' && e.itemId === item.id) {
      const expected =
        e.expectedDate ??
        (item.sourcing?.leadTimeDays !== undefined
          ? addDays(e.at, item.sourcing.leadTimeDays)
          : undefined);
      arrival = { state: 'ordered', orderedAt: e.at, expected, eventId: e.id };
      totals = { expected: 0, received: 0, damaged: 0 };
    }
    if (e.kind === 'delivery' && e.itemId === item.id) {
      totals = {
        expected: Math.max(totals.expected, e.expected),
        received: totals.received + e.received,
        damaged: totals.damaged + e.damaged,
      };
      const usable = totals.received - totals.damaged;
      arrival = {
        state: usable >= totals.expected ? 'delivered' : 'short',
        at: e.at,
        received: totals.received,
        expected: totals.expected,
        damaged: totals.damaged,
        eventId: e.id,
      };
    }
  }
  return arrival;
}

/** The date an item can be counted on site, if known. Undefined = not ordered / no lead time. */
export function expectedOnSite(arrival: Arrival): IsoDate | undefined {
  if (arrival.state === 'ordered') return arrival.expected;
  if (arrival.state === 'delivered') return arrival.at;
  return undefined; // not ordered, or short — the missing part has no date
}

export type Job = Extract<ProjectEvent, { kind: 'schedule' }>;

/** A rescheduled job is a new schedule entry with the same title; only the latest one counts. */
export function latestJobs(events: ProjectEvent[]): Job[] {
  const byTitle = new Map<string, Job>();
  for (const e of events) if (e.kind === 'schedule') byTitle.set(e.title, e);
  return [...byTitle.values()];
}

export type Collision = {
  item: Item;
  job: Job;
  arrival: Arrival;
  /** Days the item lands after the job it is needed for. */
  lateBy: number;
};

/** Upcoming jobs whose material will not be on site in time. */
export function collisions(items: Item[], events: ProjectEvent[], now: IsoDate): Collision[] {
  const out: Collision[] = [];
  for (const job of latestJobs(events)) {
    if (!job.needs || daysBetween(now, job.date) < 0) continue;
    for (const itemId of job.needs) {
      const item = items.find((i) => i.id === itemId);
      if (!item) continue;
      const arrival = arrivalOf(item, events);
      const onSite = expectedOnSite(arrival);
      if (onSite === undefined) continue;
      const lateBy = daysBetween(job.date, onSite);
      if (lateBy > 0) out.push({ item, job, arrival, lateBy });
    }
  }
  return out;
}

/** The first job that needs this item and will not have it in time, if any. */
export const collisionFor = (item: Item, events: ProjectEvent[], now: IsoDate) =>
  collisions([item], events, now)[0];
