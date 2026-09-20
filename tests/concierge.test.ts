import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allSuggestions,
  leadTimeCollisions,
  overdueApprovals,
  unresolvedShortfalls,
  weeklyDigest,
} from '../src/concierge/rules';
import {
  HOMEOWNER,
  HOMEOWNER_2,
  NOW,
  sampleEvents,
  sampleItems,
  sampleMembers,
  sampleProject,
} from '../src/data/sample';
import { addDays, newInviteCode, validInviteCode } from '../src/model/format';
import { arrivalOf, collisionFor, expectedOnSite } from '../src/model/logistics';
import { approvalState, approvals, openApprovals, projectProgress } from '../src/model/progress';
import type { ProjectEvent } from '../src/model/types';

const input = {
  projectId: sampleProject.id,
  events: sampleEvents,
  items: sampleItems,
  members: sampleMembers,
  now: NOW,
};

test('progress is derived from the latest status of each milestone', () => {
  const p = projectProgress(sampleEvents);
  assert.equal(p.total, 6);
  assert.equal(p.done, 2); // Demolition, Rough plumbing (planned → started → done)
  assert.equal(p.percent, 33);
  assert.equal(p.current?.title, 'Tile floor & walls');
});

test('approvals pair requests with decisions and remember the request entry', () => {
  const a = approvals(sampleEvents);
  assert.equal(a.length, 2);
  assert.equal(openApprovals(sampleEvents).length, 2);
  assert.equal(a.find((x) => x.approvalId === 'appr-grout')?.requestedEventId, 'ev-12');
});

test('request changes keeps the approval open until the contractor asks again', () => {
  const decided: ProjectEvent = {
    id: 'ev-d1',
    projectId: sampleProject.id,
    at: NOW,
    authorId: HOMEOWNER.userId,
    authorName: 'Dana Whitfield',
    authorRole: 'homeowner',
    audience: [HOMEOWNER.userId],
    replies: [],
    kind: 'approval_decided',
    approvalId: 'appr-grout',
    decision: 'changes_requested',
    body: 'Can we see a sample first?',
  };
  const afterChanges = [...sampleEvents, decided];
  const a = approvals(afterChanges).find((x) => x.approvalId === 'appr-grout')!;
  assert.equal(approvalState(a), 'changes_requested');
  assert.equal(a.decisionNote, 'Can we see a sample first?');
  assert.equal(a.round, 1);
  assert.ok(
    openApprovals(afterChanges).some((x) => x.approvalId === 'appr-grout'),
    'still open',
  );

  // The concierge now points at the contractor, not the homeowner.
  const s = overdueApprovals({ ...input, events: afterChanges });
  const card = s.find((x) => x.id.startsWith('changes:appr-grout'))!;
  assert.equal(card.audience, 'contractor');
  assert.match(card.title, /Dana Whitfield asked for changes/);
  assert.match(card.detail, /see a sample first/);
  assert.deepEqual(
    card.source.map((x) => x.id),
    ['item-grout', 'ev-d1', 'ev-12'],
  );
  assert.ok(!s.some((x) => x.id === 'approval:appr-grout'), 'no longer "waiting on homeowner"');

  // Re-requesting resets it to pending, round 2.
  const rerequest: ProjectEvent = {
    id: 'ev-r2',
    projectId: sampleProject.id,
    at: NOW,
    authorId: 'user-mike',
    authorName: 'Mike Alvarez',
    authorRole: 'contractor',
    audience: [HOMEOWNER.userId],
    replies: [],
    kind: 'approval_requested',
    approvalId: 'appr-grout',
    title: 'Grout colour: Warm Gray (sample attached)',
    itemId: 'item-grout',
  };
  const b = approvals([...afterChanges, rerequest]).find((x) => x.approvalId === 'appr-grout')!;
  assert.equal(approvalState(b), 'pending');
  assert.equal(b.round, 2);
  assert.equal(b.requestedEventId, 'ev-r2');
  const s2 = overdueApprovals({ ...input, events: [...afterChanges, rerequest] });
  assert.match(s2.find((x) => x.id === 'approval:appr-grout')!.title, /revised, round 2/);
});

test('logistics: arrival and collisions come from the same arithmetic the concierge uses', () => {
  const vanity = sampleItems.find((i) => i.id === 'item-vanity')!;
  const tile = sampleItems.find((i) => i.id === 'item-floor-tile')!;
  const grout = sampleItems.find((i) => i.id === 'item-grout')!;
  const v = arrivalOf(vanity, sampleEvents);
  assert.equal(v.state, 'ordered');
  assert.equal(expectedOnSite(v), addDays(NOW, 24));
  const c = collisionFor(vanity, sampleEvents, NOW)!;
  assert.equal(c.job.title, 'Vanity & fixture install');
  assert.equal(c.lateBy, 6);
  const t = arrivalOf(tile, sampleEvents);
  assert.equal(t.state, 'short');
  assert.equal(
    collisionFor(tile, sampleEvents, NOW),
    undefined,
    'short deliveries have no date to collide with',
  );
  assert.equal(arrivalOf(grout, sampleEvents).state, 'not_ordered');
  // Every drafted note carries references the reader can jump to.
  for (const s of allSuggestions(input))
    if (s.proposedEvent)
      assert.ok((s.proposedEvent.refs?.length ?? 0) > 0, `${s.id} draft has refs`);
});

test('every suggestion cites at least one source', () => {
  for (const s of allSuggestions(input)) assert.ok(s.source.length > 0, s.id);
});

test('an approval past its due date is urgent, aimed at the homeowner, and cites the request', () => {
  const s = overdueApprovals(input);
  const grout = s.find((x) => x.id === 'approval:appr-grout')!;
  assert.equal(grout.severity, 'urgent');
  assert.equal(grout.audience, 'homeowner');
  assert.match(grout.detail, /was due/);
  assert.deepEqual(
    grout.source.map((x) => x.id),
    ['item-grout', 'ev-12'],
    'cites the item and the request',
  );
  const glass = s.find((x) => x.id === 'approval:appr-glass')!;
  assert.equal(glass.severity, 'info');
});

test('a job scheduled before its material arrives is flagged, cites item + order + job, and proposes a reschedule', () => {
  const s = leadTimeCollisions(input);
  const vanity = s.find((x) => x.id.startsWith('collision:') && x.id.endsWith('item-vanity'))!;
  assert.ok(vanity, 'vanity install is 6 days before the vanity arrives');
  assert.equal(vanity.severity, 'urgent');
  assert.deepEqual(
    vanity.source.map((x) => x.id),
    ['item-vanity', 'ev-08', 'ev-18'],
  );
  assert.equal(vanity.proposedEvent?.kind, 'schedule');
  // The reschedule goes to the same people the original schedule went to.
  assert.deepEqual(vanity.proposedEvent?.audience, [HOMEOWNER.userId, HOMEOWNER_2.userId]);
  // Grout is needed for tile install but has never been ordered — and Dana is the one buying it.
  const grout = s.find((x) => x.id.startsWith('unordered:') && x.id.endsWith('item-grout'))!;
  assert.ok(grout);
  assert.match(grout.detail, /homeowner is buying/);
  // Tile is delivered (short, but here) so it is not a collision.
  assert.ok(!s.some((x) => x.id.endsWith('item-floor-tile')));
});

test('when the homeowner has to buy or chase something, the concierge drafts the reminder', () => {
  const s = leadTimeCollisions(input);
  const grout = s.find((x) => x.id.startsWith('unordered:') && x.id.endsWith('item-grout'))!;
  assert.equal(grout.action?.confirm, 'Send reminder');
  assert.equal(grout.proposedEvent?.kind, 'note');
  assert.deepEqual(grout.proposedEvent?.audience, [HOMEOWNER.userId, HOMEOWNER_2.userId]);
  assert.match(grout.proposedEvent?.body ?? '', /order by Sep 19/);
  assert.match(grout.proposedEvent?.body ?? '', /Emser Tile \(SKU GR-WG-25\)/);
  assert.match(grout.proposedEvent?.body ?? '', /3 bags/);
  // Contractor-supplied items get no reminder draft — nothing for the homeowner to do.
  const vanity = s.find((x) => x.id.startsWith('collision:'))!;
  assert.equal(vanity.action, undefined);

  const short = unresolvedShortfalls(input)[0]!;
  assert.equal(short.action?.confirm, 'Send reminder');
  assert.match(short.proposedEvent?.body ?? '', /3 boxes short/);
  assert.match(short.proposedEvent?.body ?? '', /order SO-118842/);

  const approvals = overdueApprovals(input);
  const overdue = approvals.find((x) => x.id === 'approval:appr-grout')!;
  assert.equal(overdue.action?.confirm, 'Send reminder');
  assert.deepEqual(
    overdue.proposedEvent?.audience,
    [HOMEOWNER.userId],
    'nudge goes to who was asked',
  );
  assert.match(overdue.proposedEvent?.body ?? '', /was due Sep 18/);
  const fresh = approvals.find((x) => x.id === 'approval:appr-glass')!;
  assert.equal(fresh.proposedEvent, undefined, 'no nudge on a request made today');
});

test('rescheduling a job replaces it in the collision check', () => {
  const vanityJob = sampleEvents.find((e) => e.id === 'ev-18') as Extract<
    ProjectEvent,
    { kind: 'schedule' }
  >;
  const moved = leadTimeCollisions({
    ...input,
    events: [
      ...sampleEvents,
      { ...vanityJob, id: 'ev-moved', at: NOW, date: addDays(NOW, 30), body: 'Moved from Oct 7.' },
    ],
  });
  assert.ok(
    !moved.some((x) => x.id.startsWith('collision:') && x.id.endsWith('item-vanity')),
    'vanity now arrives before the job',
  );
  assert.ok(
    !moved.some((x) => x.id === 'collision:ev-18:item-vanity'),
    'the old date no longer counts',
  );
});

test('a short delivery stays flagged until made whole', () => {
  const s = unresolvedShortfalls(input);
  assert.equal(s.length, 1);
  assert.match(s[0]!.title, /3 boxes short/); // 14 expected, 12 received, 1 damaged → 11 usable
  assert.match(s[0]!.detail, /homeowner placed this order/);
  assert.deepEqual(
    s[0]!.source.map((x) => x.id),
    ['item-floor-tile', 'ev-16'],
  );
  const madeWhole = unresolvedShortfalls({
    ...input,
    events: [
      ...sampleEvents,
      {
        ...(sampleEvents.find((e) => e.id === 'ev-16') as Extract<
          ProjectEvent,
          { kind: 'delivery' }
        >),
        id: 'ev-x',
        at: NOW,
        expected: 14,
        received: 3,
        damaged: 0,
      },
    ],
  });
  assert.equal(madeWhole.length, 0);
});

test('weekly digest is per homeowner, built only from what they can see, and is a draft', () => {
  const since = addDays(NOW, -10); // wide enough to include the grout request (9 days ago)
  const forDana = weeklyDigest(input, HOMEOWNER.userId, since)!;
  assert.equal(forDana.proposedEvent?.kind, 'note');
  assert.deepEqual(forDana.proposedEvent?.audience, [HOMEOWNER.userId]);
  assert.ok(
    !forDana.proposedEvent?.body?.includes('Watch this one'),
    'team note must not appear in a homeowner digest',
  );
  assert.ok(forDana.proposedEvent?.body?.includes('Tile install'));
  assert.ok(forDana.proposedEvent?.body?.includes('Grout colour'), 'Dana was asked about grout');

  const forSam = weeklyDigest(input, HOMEOWNER_2.userId, since)!;
  assert.deepEqual(forSam.proposedEvent?.audience, [HOMEOWNER_2.userId]);
  assert.ok(!forSam.proposedEvent?.body?.includes('Grout colour'), 'Sam was not asked about grout');
  assert.ok(forSam.source.every((src) => src.kind === 'event'));

  assert.equal(weeklyDigest(input, 'user-stranger', since), undefined);
  // The default window is one week.
  assert.ok(!weeklyDigest(input, HOMEOWNER.userId)?.proposedEvent?.body?.includes('Grout colour'));
});

test('suggestions come back most urgent first', () => {
  const s = allSuggestions(input);
  assert.ok(s.length >= 5);
  assert.equal(s.filter((x) => x.id.startsWith('digest:')).length, 2, 'one digest per homeowner');
  const order = { urgent: 0, attention: 1, info: 2 };
  for (let i = 1; i < s.length; i++) assert.ok(order[s[i - 1]!.severity] <= order[s[i]!.severity]);
});

test('invite codes avoid ambiguous characters and validate', () => {
  for (let i = 0; i < 200; i++) {
    const code = newInviteCode();
    assert.ok(validInviteCode(code), code);
    assert.ok(!/[01IO]/.test(code), code);
  }
  assert.ok(!validInviteCode('ABCDEFG0'));
  assert.ok(validInviteCode(' abcdefgh '));
});
