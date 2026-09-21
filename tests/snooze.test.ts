import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Suggestion } from '../src/concierge/rules';
import {
  customSnooze,
  maxSnoozeDays,
  placeSnooze,
  snoozeOptions,
  snoozeReason,
} from '../src/concierge/snooze';
import { addDays } from '../src/model/format';

const NOW = '2026-09-21T17:00:00.000Z';
const card = (severity: Suggestion['severity'], dueInDays?: number): Suggestion => ({
  id: 'sug-1',
  severity,
  audience: 'contractor',
  title: 'Order the tile',
  detail: '',
  source: [{ kind: 'item', id: 'item-1', label: 'Tile' }],
  dueBy: dueInDays === undefined ? undefined : addDays(NOW, dueInDays),
});
const labels = (s: Suggestion) =>
  snoozeOptions(s, NOW).map((o) => `${o.label}${o.cutsClose ? '!' : ''}`);

test('a card due in ten days offers 1, 3 and 7; nothing cuts close', () => {
  assert.deepEqual(labels(card('attention', 10)), ['1 day', '3 days', '7 days']);
});

test('a card due in four days drops 7 entirely; 3 is offered but cuts close', () => {
  assert.deepEqual(labels(card('attention', 4)), ['1 day', '3 days!']);
});

test('a card due tomorrow offers nothing — only rescheduling is left', () => {
  assert.deepEqual(labels(card('attention', 1)), []);
  assert.equal(maxSnoozeDays(card('attention', 1), NOW), 0);
});

test('no deadline means every choice is offered, comfortably', () => {
  assert.deepEqual(labels(card('info')), ['1 day', '3 days', '7 days']);
  assert.equal(maxSnoozeDays(card('info'), NOW), undefined);
});

test('a custom number inside the buffer prompts; past the deadline it is refused, not silently clamped', () => {
  const s = card('attention', 4);
  const close = customSnooze(s, NOW, 3);
  assert.ok(close.ok && close.option.cutsClose, 'three days lands in the buffer');
  const fine = customSnooze(s, NOW, 2);
  assert.ok(fine.ok && !fine.option.cutsClose);
  const late = customSnooze(s, NOW, 4);
  assert.ok(
    !late.ok && /Reschedule/.test(late.reason),
    'on the deadline is refused with a way out',
  );
  assert.ok(!customSnooze(s, NOW, 0).ok);
  assert.ok(!customSnooze(s, NOW, 1.5).ok);
  assert.equal(maxSnoozeDays(s, NOW), 3);
});

test('the lead-time deadline is the one that bites: the rules put the order-by date in dueBy', () => {
  // Job in 21 days, 28-day lead time: dueBy is already in the past, so nothing can be snoozed.
  const s = card('attention', 21 - 28);
  assert.deepEqual(labels(s), []);
  // Job in 21 days, 14-day lead time: order-by is in 7 days, so 7 days is off the table.
  assert.deepEqual(labels(card('attention', 7)), ['1 day', '3 days']);
});

test('urgent offers six hours and nothing else, even when that cuts close', () => {
  const opts = snoozeOptions(card('urgent', 10), NOW);
  assert.equal(opts.length, 1);
  assert.equal(opts[0]!.hours, 6);
  assert.equal(opts[0]!.until, '2026-09-21T23:00:00.000Z');
  assert.equal(opts[0]!.cutsClose, false);
  const soon = snoozeOptions(card('urgent', 1), NOW);
  assert.equal(soon.length, 1);
  assert.equal(soon[0]!.cutsClose, true, 'tonight is inside the one-day buffer');
  assert.deepEqual(
    snoozeOptions(card('urgent', -1), NOW),
    [],
    'past the deadline: reschedule, do not snooze',
  );
});

test('the buffer rule, stated once', () => {
  const deadline = addDays(NOW, 5);
  assert.equal(placeSnooze(addDays(NOW, 3), deadline), undefined);
  assert.equal(
    placeSnooze(addDays(NOW, 4), deadline),
    'close',
    'exactly one day before is inside the buffer',
  );
  assert.equal(placeSnooze(addDays(NOW, 5), deadline), 'late', 'on the deadline is too late');
  assert.equal(placeSnooze(addDays(NOW, 3), undefined), undefined);
});

test('the record reads as a working note, and says when it was confirmed close', () => {
  const s = card('attention', 4);
  const [one, three] = snoozeOptions(s, NOW);
  assert.equal(snoozeReason(one!, s), 'Reminder paused until Sep 22 — due Sep 25');
  assert.equal(
    snoozeReason(three!, s),
    'Reminder paused until Sep 24 — due Sep 25 (cuts close; confirmed)',
  );
  const [urgent] = snoozeOptions(card('urgent', 10), NOW);
  assert.equal(
    snoozeReason(urgent!, card('urgent', 10)),
    'Reminder paused for 6 hours — due Oct 1',
  );
});

test('a six-hour pause hides the card now and brings it back after six hours, not tomorrow', async () => {
  const { partitionSuggestions } = await import('../src/concierge/dismissals');
  const { addHours } = await import('../src/concierge/snooze');
  const s = card('urgent', 10);
  const paused: import('../src/model/types').ProjectEvent = {
    id: 'ev-1',
    projectId: 'p',
    at: NOW,
    authorId: 'u',
    authorName: 'Mike',
    authorRole: 'contractor',
    audience: [],
    replies: [],
    kind: 'dismissal',
    suggestionId: s.id,
    title: s.title,
    severity: 'urgent',
    action: 'dismiss',
    until: addHours(NOW, 6),
    snooze: { hours: 6, cutsClose: false },
  };
  const later = (h: number) => partitionSuggestions([s], [paused], addHours(NOW, h));
  assert.equal(later(1).active.length, 0, 'hidden an hour in');
  assert.equal(later(1).archived[0]?.returnsAt, addHours(NOW, 6));
  assert.equal(later(5).active.length, 0, 'still hidden at five hours');
  assert.equal(later(6).active.length, 1, 'back on the dot');
});
