import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comebackDays,
  dismissUntil,
  mustSnooze,
  partitionSuggestions,
} from '../src/concierge/dismissals';
import { allSuggestions, type Suggestion } from '../src/concierge/rules';
import { LocalRepository } from '../src/data/localRepository';
import {
  CONTRACTOR,
  HOMEOWNER,
  NOW,
  sampleEvents,
  sampleItems,
  sampleMembers,
  sampleProject,
} from '../src/data/sample';
import { addDays } from '../src/model/format';
import type { ProjectEvent } from '../src/model/types';

const input = {
  projectId: sampleProject.id,
  events: sampleEvents,
  items: sampleItems,
  members: sampleMembers,
  now: NOW,
};

const dismissal = (
  s: Suggestion,
  at: string,
  action: 'dismiss' | 'restore' | 'acted',
  until?: string,
): ProjectEvent => ({
  id: `ev-dis-${at}-${action}`,
  projectId: sampleProject.id,
  at,
  authorId: CONTRACTOR.userId,
  authorName: CONTRACTOR.displayName,
  authorRole: 'contractor',
  audience: [],
  replies: [],
  kind: 'dismissal',
  suggestionId: s.id,
  title: s.title,
  severity: s.severity,
  action,
  until,
});

test('how long a dismissal holds depends on how loud the suggestion is', () => {
  assert.equal(comebackDays('urgent'), 1);
  assert.equal(comebackDays('attention'), 3);
  assert.equal(comebackDays('info'), undefined);
});

test('an urgent suggestion dismissed today is back tomorrow; attention after three days; info stays away', () => {
  const all = allSuggestions(input);
  const urgent = all.find((s) => s.severity === 'urgent')!;
  const attention = all.find((s) => s.severity === 'attention')!;
  const info = all.find((s) => s.severity === 'info')!;
  const events = [
    ...sampleEvents,
    dismissal(urgent, NOW, 'dismiss', dismissUntil(urgent, NOW)),
    dismissal(attention, NOW, 'dismiss', dismissUntil(attention, NOW)),
    dismissal(info, NOW, 'dismiss', dismissUntil(info, NOW)),
  ];
  const today = partitionSuggestions(all, events, NOW);
  assert.ok(
    today.archived.some((x) => x.suggestion.id === urgent.id),
    'urgent hidden today',
  );
  assert.ok(today.archived.some((x) => x.suggestion.id === attention.id));
  assert.ok(today.archived.some((x) => x.suggestion.id === info.id));
  assert.equal(
    today.archived.find((x) => x.suggestion.id === urgent.id)!.returnsAt,
    addDays(NOW, 1),
  );
  assert.equal(
    today.archived.find((x) => x.suggestion.id === info.id)!.returnsAt,
    undefined,
    'info never comes back on its own',
  );

  const tomorrow = partitionSuggestions(all, events, addDays(NOW, 1));
  assert.ok(
    tomorrow.active.some((x) => x.suggestion.id === urgent.id),
    'urgent is back',
  );
  assert.ok(
    tomorrow.archived.some((x) => x.suggestion.id === attention.id),
    'attention still away',
  );
  assert.equal(
    tomorrow.active.find((x) => x.suggestion.id === urgent.id)!.timesDismissed,
    1,
    'and it knows it was set aside once',
  );

  const inFour = partitionSuggestions(all, events, addDays(NOW, 4));
  assert.ok(
    inFour.active.some((x) => x.suggestion.id === attention.id),
    'attention is back after three days',
  );
  assert.ok(
    inFour.archived.some((x) => x.suggestion.id === info.id),
    'info still away',
  );
});

test('restore brings a suggestion back immediately; dismissing again counts up', () => {
  const all = allSuggestions(input);
  const info = all.find((s) => s.severity === 'info')!;
  const events = [
    ...sampleEvents,
    dismissal(info, NOW, 'dismiss'),
    dismissal(info, addDays(NOW, 0.1), 'restore'),
  ];
  const after = partitionSuggestions(all, events, addDays(NOW, 0.2));
  const st = after.active.find((x) => x.suggestion.id === info.id)!;
  assert.ok(st, 'restored');
  assert.equal(st.timesDismissed, 1);
  const again = partitionSuggestions(
    all,
    [...events, dismissal(info, addDays(NOW, 0.3), 'dismiss')],
    addDays(NOW, 0.4),
  );
  assert.equal(again.archived.find((x) => x.suggestion.id === info.id)!.timesDismissed, 2);
});

test('on or after the due date a suggestion cannot be dismissed, only snoozed', () => {
  const all = allSuggestions(input);
  const grout = all.find((s) => s.id === 'approval:appr-grout')!; // due yesterday
  const glass = all.find((s) => s.id === 'approval:appr-glass')!; // due in a week
  assert.ok(mustSnooze(grout, NOW));
  assert.ok(!mustSnooze(glass, NOW));
  const collision = all.find((s) => s.id.startsWith('collision:'))!;
  assert.equal(collision.dueBy, addDays(NOW, 18), 'collision is due when the job is');
  const unordered = all.find((s) => s.id.startsWith('unordered:'))!;
  assert.equal(
    unordered.dueBy,
    addDays(NOW, 0),
    'grout must be ordered today (3-day lead, install in 3)',
  );
  assert.ok(mustSnooze(unordered, NOW), 'so it can only be snoozed');
});

test('a dismissal is on the record for the contractor and invisible to homeowners', async () => {
  const repo = new LocalRepository('contractor', { clock: LocalRepository.sampleClock });
  const all = allSuggestions(input);
  const s = all[0]!;
  const posted = await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'dismissal',
    suggestionId: s.id,
    title: s.title,
    severity: s.severity,
    action: 'dismiss',
    until: dismissUntil(s, NOW),
    audience: [HOMEOWNER.userId], // even if the caller tries, it is business-only
  });
  assert.deepEqual(posted.audience, []);
  assert.ok((await repo.listEvents(sampleProject.id)).some((e) => e.id === posted.id));
  repo.setViewer(HOMEOWNER.userId);
  assert.ok(!(await repo.listEvents(sampleProject.id)).some((e) => e.kind === 'dismissal'));
  await assert.rejects(
    () =>
      repo.appendEvent({
        projectId: sampleProject.id,
        kind: 'dismissal',
        suggestionId: 'x',
        title: 'x',
        severity: 'info',
        action: 'dismiss',
        audience: [],
      }),
    /notes, photos and approval decisions/,
    'a homeowner cannot post one',
  );
});
