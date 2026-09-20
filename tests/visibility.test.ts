import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRepository } from '../src/data/localRepository';
import {
  CONTRACTOR,
  HOMEOWNER,
  HOMEOWNER_2,
  sampleEvents,
  sampleItems,
  sampleMembers,
  sampleProject,
} from '../src/data/sample';
import {
  audienceLabel,
  defaultAudience,
  modeDefaults,
  redactItem,
  visibleEvents,
} from '../src/model/visibility';

const mike = { role: 'contractor', userId: CONTRACTOR.userId } as const;
const dana = { role: 'homeowner', userId: HOMEOWNER.userId } as const;
const sam = { role: 'homeowner', userId: HOMEOWNER_2.userId } as const;

test('contractor sees every entry; a homeowner sees only entries addressed to them', () => {
  const all = visibleEvents(mike, sampleEvents);
  const forDana = visibleEvents(dana, sampleEvents);
  const forSam = visibleEvents(sam, sampleEvents);
  assert.equal(all.length, sampleEvents.length);
  assert.ok(forDana.length < all.length);
  assert.ok(forDana.every((e) => e.audience.includes(HOMEOWNER.userId)));
  assert.ok(
    !forDana.some((e) => e.kind === 'note' && e.body?.includes('Watch this one')),
    'margin note must not leak',
  );
  // The grout approval was addressed to Dana alone: Sam does not see it, Dana does.
  assert.ok(forDana.some((e) => e.kind === 'approval_requested' && e.approvalId === 'appr-grout'));
  assert.ok(!forSam.some((e) => e.kind === 'approval_requested' && e.approvalId === 'appr-grout'));
  // Both see the entries addressed to both.
  assert.ok(forSam.some((e) => e.id === 'ev-19'));
});

test('redactItem: team fields never leave; sourcing and price follow who buys', () => {
  const vanity = sampleItems.find((i) => i.id === 'item-vanity')!; // contractor buys
  const tile = sampleItems.find((i) => i.id === 'item-floor-tile')!; // homeowner buys

  const v = redactItem('homeowner', sampleProject, vanity);
  assert.equal(v.team, undefined);
  assert.equal(v.sourcing, undefined, 'contractor-supplied item hides supplier and SKU');
  assert.equal(v.clientPrice, 184000, 'hybrid project shows prices');
  assert.equal(v.sharePrice, undefined);

  const t = redactItem('homeowner', sampleProject, tile);
  assert.equal(t.team, undefined, 'the internal note about Dana never reaches Dana');
  assert.equal(t.sourcing?.sku, 'HAN-1224-GR', 'she has to order it, so she gets the SKU');
  assert.equal(t.clientPrice, 98000);

  assert.deepEqual(redactItem('contractor', sampleProject, vanity), vanity);
});

test('all-in projects hide prices on contractor-supplied items unless shared per item', () => {
  const allIn = { ...sampleProject, ...modeDefaults('all_in') };
  const vanity = sampleItems.find((i) => i.id === 'item-vanity')!;
  assert.equal(redactItem('homeowner', allIn, vanity).clientPrice, undefined);
  assert.equal(redactItem('homeowner', allIn, { ...vanity, sharePrice: true }).clientPrice, 184000);
  assert.equal(
    redactItem('homeowner', allIn, { ...vanity, shareSourcing: true }).sourcing?.supplier,
    'Northline Cabinetry',
  );
  // Something the homeowner buys is priced for them regardless of mode.
  const tile = sampleItems.find((i) => i.id === 'item-floor-tile')!;
  assert.equal(redactItem('homeowner', allIn, tile).clientPrice, 98000);
});

test('defaults: notes and deliveries are team-only, everything else goes to every homeowner', () => {
  assert.deepEqual(defaultAudience('note', sampleMembers), []);
  assert.deepEqual(defaultAudience('delivery', sampleMembers), []);
  for (const kind of [
    'milestone',
    'schedule',
    'order',
    'approval_requested',
    'approval_decided',
    'photo',
    'document_sent',
  ] as const)
    assert.deepEqual(defaultAudience(kind, sampleMembers), [HOMEOWNER.userId, HOMEOWNER_2.userId]);
  assert.equal(audienceLabel([], sampleMembers), 'Your business only');
  assert.equal(audienceLabel([HOMEOWNER.userId], sampleMembers), 'Shared with Dana');
  assert.equal(
    audienceLabel([HOMEOWNER.userId, HOMEOWNER_2.userId], sampleMembers),
    'Shared with Dana, Sam',
  );
});

test('local repository enforces the same rules as the database functions', async () => {
  const repo = new LocalRepository('homeowner', { clock: LocalRepository.sampleClock });
  const items = await repo.listItems(sampleProject.id);
  assert.ok(items.every((i) => i.team === undefined));
  await assert.rejects(
    () =>
      repo.appendEvent({
        projectId: sampleProject.id,
        kind: 'milestone',
        title: 'x',
        status: 'done',
        audience: [HOMEOWNER.userId],
      }),
    /notes, photos and approval decisions/,
  );
  // A homeowner cannot post team-only or to a subset: the audience is forced to every homeowner.
  const ok = await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'note',
    audience: [],
    body: 'Question',
  });
  assert.equal(ok.authorRole, 'homeowner');
  assert.deepEqual([...ok.audience].sort(), [HOMEOWNER.userId, HOMEOWNER_2.userId].sort());
  await assert.rejects(
    () => repo.createInvitation(sampleProject.id, 'x@y.z'),
    /Only the contractor/,
  );
  // Sam cannot reply to something addressed to Dana alone.
  repo.setViewer(HOMEOWNER_2.userId);
  await assert.rejects(() => repo.reply(sampleProject.id, 'ev-12', 'hi'), /Not visible/);

  // The contractor may not address people who are not on the project.
  repo.setViewer('contractor');
  await assert.rejects(
    () =>
      repo.appendEvent({
        projectId: sampleProject.id,
        kind: 'note',
        audience: ['user-stranger'],
        body: 'x',
      }),
    /members of this project/,
  );
});

test('request changes → item shows Change requested; re-request → proposed; approve → approved', async () => {
  const repo = new LocalRepository('homeowner', { clock: LocalRepository.sampleClock });
  await repo.decideApproval(
    sampleProject.id,
    'appr-grout',
    'changes_requested',
    'Sample first please',
  );
  let grout = (await repo.listItems(sampleProject.id)).find((i) => i.id === 'item-grout')!;
  assert.equal(grout.status, 'changes_requested');
  await assert.rejects(
    () => repo.decideApproval(sampleProject.id, 'appr-grout', 'approved'),
    /Already decided/,
    'the same request cannot be decided twice',
  );
  // Mike revises and asks again.
  repo.setViewer('contractor');
  await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'approval_requested',
    approvalId: 'appr-grout',
    title: 'Grout colour: Warm Gray (sample attached)',
    itemId: 'item-grout',
    audience: [HOMEOWNER.userId],
  });
  grout = (await repo.listItems(sampleProject.id)).find((i) => i.id === 'item-grout')!;
  assert.equal(grout.status, 'proposed', 'back under discussion');
  // Dana can now decide the new round.
  repo.setViewer(HOMEOWNER.userId);
  const decided = await repo.decideApproval(sampleProject.id, 'appr-grout', 'approved');
  assert.equal(decided.kind, 'approval_decided');
  grout = (await repo.listItems(sampleProject.id)).find((i) => i.id === 'item-grout')!;
  assert.equal(grout.status, 'approved');
});

test('approving an item moves it from proposed to approved, once, and the decision keeps the request audience', async () => {
  const repo = new LocalRepository('homeowner', { clock: LocalRepository.sampleClock });
  const decided = await repo.decideApproval(sampleProject.id, 'appr-grout', 'approved');
  assert.deepEqual(decided.audience, [HOMEOWNER.userId], 'Dana-only request → Dana-only decision');
  const grout = (await repo.listItems(sampleProject.id)).find((i) => i.id === 'item-grout')!;
  assert.equal(grout.status, 'approved');
  await assert.rejects(
    () => repo.decideApproval(sampleProject.id, 'appr-grout', 'approved'),
    /Already decided/,
  );
});
