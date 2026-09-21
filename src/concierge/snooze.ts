// Snoozing replaces "dismiss". A card is never made to go away for good — it is paused, and
// the pause is capped by the calendar:
//
//   • urgent cards pause for hours, not days (six by default; a contractor setting later)
//   • other cards offer 1 / 3 / 7 days or a custom number of days
//   • no option may land on or after the card's deadline — those are not offered at all
//   • an option landing inside the one-day buffer before the deadline is offered, but the
//     card says it cuts close and the contractor confirms; that answer goes on the record
//
// The deadline is the suggestion's `dueBy`, which the rules already set to the date that bites
// first: the order-by date (job date minus lead time) for something that has to be bought,
// the job date otherwise, the decide-by date for an approval.
//
// Every snooze is a business-only `dismissal` entry (action 'dismiss' + `until`), the same
// record a dismissal used to make, so "paused until the 24th" is on the record and nothing
// reaches the homeowner. The wording is a working note, never a charge.

import { addDays, daysBetween, shortDate } from '../model/format';
import type { IsoDate } from '../model/types';
import type { Suggestion } from './rules';

/** Defaults until contractor onboarding lets each business set its own. */
export const SNOOZE_DEFAULTS = {
  urgentHours: 6,
  bufferDays: 1,
  dayChoices: [1, 3, 7] as readonly number[],
};
export type SnoozeSettings = typeof SNOOZE_DEFAULTS;

export type SnoozeOption = {
  /** What the contractor picked, for the record and the button label. */
  hours?: number;
  days?: number;
  until: IsoDate;
  label: string;
  /** Lands inside the buffer before the deadline: offered, but asks for a confirmation. */
  cutsClose: boolean;
};

export const addHours = (iso: IsoDate, hours: number): IsoDate =>
  new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();

const isBefore = (a: IsoDate, b: IsoDate) => new Date(a).getTime() < new Date(b).getTime();

/**
 * Where a pause may land: undefined = allowed and comfortable; 'close' = inside the buffer;
 * 'late' = on or after the deadline, never offered.
 */
export function placeSnooze(
  until: IsoDate,
  deadline: IsoDate | undefined,
  settings: SnoozeSettings = SNOOZE_DEFAULTS,
): undefined | 'close' | 'late' {
  if (deadline === undefined) return undefined;
  if (!isBefore(until, deadline)) return 'late';
  if (!isBefore(until, addDays(deadline, -settings.bufferDays))) return 'close';
  return undefined;
}

/** The choices a card offers now. Empty means only a custom number of days could work. */
export function snoozeOptions(
  s: Suggestion,
  now: IsoDate,
  settings: SnoozeSettings = SNOOZE_DEFAULTS,
): SnoozeOption[] {
  if (s.severity === 'urgent') {
    const until = addHours(now, settings.urgentHours);
    const place = placeSnooze(until, s.dueBy, settings);
    // A few hours is the whole point of urgent; it is offered even when it cuts close, and
    // only withheld when the deadline has already gone by.
    if (place === 'late' && s.dueBy !== undefined && !isBefore(now, s.dueBy)) return [];
    return [
      {
        hours: settings.urgentHours,
        until,
        label: `${settings.urgentHours} hours`,
        cutsClose: place !== undefined,
      },
    ];
  }
  const options: SnoozeOption[] = [];
  for (const days of settings.dayChoices) {
    const until = addDays(now, days);
    const place = placeSnooze(until, s.dueBy, settings);
    if (place === 'late') continue;
    options.push({
      days,
      until,
      label: `${days} day${days === 1 ? '' : 's'}`,
      cutsClose: place === 'close',
    });
  }
  return options;
}

/** A custom number of days. Refused (with the reason) when it would land on or after the deadline. */
export function customSnooze(
  s: Suggestion,
  now: IsoDate,
  days: number,
  settings: SnoozeSettings = SNOOZE_DEFAULTS,
): { ok: true; option: SnoozeOption } | { ok: false; reason: string } {
  if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days))
    return { ok: false, reason: 'Enter a whole number of days.' };
  const until = addDays(now, days);
  const place = placeSnooze(until, s.dueBy, settings);
  if (place === 'late')
    return {
      ok: false,
      reason: `That is past ${shortDate(s.dueBy!)}, when this is due. Reschedule the date instead.`,
    };
  return {
    ok: true,
    option: {
      days,
      until,
      label: `${days} day${days === 1 ? '' : 's'}`,
      cutsClose: place === 'close',
    },
  };
}

/** The most days a custom snooze may take without landing on the deadline. Undefined = no limit. */
export function maxSnoozeDays(s: Suggestion, now: IsoDate): number | undefined {
  if (s.dueBy === undefined) return undefined;
  return Math.max(0, daysBetween(now, s.dueBy) - 1);
}

/** The line that goes on the record. A working note, not an accusation. */
export function snoozeReason(o: SnoozeOption, s: Suggestion): string {
  const until = o.hours !== undefined ? `for ${o.label}` : `until ${shortDate(o.until)}`;
  const due = s.dueBy ? ` — due ${shortDate(s.dueBy)}` : '';
  return `Reminder paused ${until}${due}${o.cutsClose ? ' (cuts close; confirmed)' : ''}`;
}
