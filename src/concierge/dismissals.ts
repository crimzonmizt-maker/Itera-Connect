// Dismissing a suggestion never deletes it. It posts a business-only `dismissal` entry, and the
// concierge reads those entries back to decide what to show:
//
//   • urgent     — comes back the next day, every day, until it is resolved or the due date
//   • attention  — comes back after three days
//   • info       — stays away until restored (or until the suggestion itself changes)
//   • on or after its due date, a suggestion cannot be plainly dismissed: the contractor picks
//     how long to snooze it (1 / 3 / 7 days) and that choice is what goes on the record
//
// "It should be really annoying" — Krimzy, 20 Sep. "Squeaky wheel gets the grease."

import { addDays, daysBetween } from '../model/format';
import type { IsoDate, ProjectEvent } from '../model/types';
import type { Suggestion } from './rules';

export type Dismissal = Extract<ProjectEvent, { kind: 'dismissal' }>;

/** How long a plain dismissal holds, by how loud the suggestion is. Undefined = until restored. */
export function comebackDays(severity: Suggestion['severity']): number | undefined {
  switch (severity) {
    case 'urgent':
      return 1;
    case 'attention':
      return 3;
    case 'info':
      return undefined;
  }
}

/** The `until` a plain dismissal made now should carry. */
export function dismissUntil(s: Suggestion, now: IsoDate): IsoDate | undefined {
  const days = comebackDays(s.severity);
  return days === undefined ? undefined : addDays(now, days);
}

/** Past (or on) its due date, dismissing is not allowed — only snoozing with an explicit date. */
export const mustSnooze = (s: Suggestion, now: IsoDate) =>
  s.dueBy !== undefined && daysBetween(s.dueBy, now) >= 0;

export type SuggestionState = {
  suggestion: Suggestion;
  /** Latest dismissal entry for this suggestion, if any. */
  last?: Dismissal;
  /** How many times it has been set aside (dismissed or snoozed) and come back. */
  timesDismissed: number;
  /** Shown in the archive rather than the active list. */
  hidden: boolean;
  /** If hidden, when it will show again on its own (undefined = only if restored). */
  returnsAt?: IsoDate;
};

/**
 * Fold the dismissal entries over the live suggestions. Rules run first and produce what is
 * true now; this only decides what the contractor has asked not to see yet.
 */
export function partitionSuggestions(
  all: Suggestion[],
  events: ProjectEvent[],
  now: IsoDate,
): { active: SuggestionState[]; archived: SuggestionState[] } {
  const byId = new Map<string, Dismissal[]>();
  for (const e of events) {
    if (e.kind !== 'dismissal') continue;
    const list = byId.get(e.suggestionId) ?? [];
    list.push(e);
    byId.set(e.suggestionId, list);
  }
  const active: SuggestionState[] = [];
  const archived: SuggestionState[] = [];
  for (const s of all) {
    const history = byId.get(s.id) ?? [];
    const last = history[history.length - 1];
    const timesDismissed = history.filter((d) => d.action !== 'restore').length;
    let hidden = false;
    let returnsAt: IsoDate | undefined;
    if (last && last.action !== 'restore') {
      // Compared to the minute, not the day: an urgent card paused for six hours must hide now
      // and be back this evening, not tomorrow.
      if (last.until === undefined) hidden = true;
      else if (new Date(now).getTime() < new Date(last.until).getTime()) {
        hidden = true;
        returnsAt = last.until;
      }
      // else: the snooze has run out — it is back, and stays back until dismissed again
    }
    const state = { suggestion: s, last, timesDismissed, hidden, returnsAt };
    (hidden ? archived : active).push(state);
  }
  return { active, archived };
}
