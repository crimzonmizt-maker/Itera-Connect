import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSuggestions } from '../src/concierge/rules';
import { LocalRepository } from '../src/data/localRepository';
import { CONTRACTOR, HOMEOWNER, NOW, sampleProject } from '../src/data/sample';
import { approvals, openApprovals } from '../src/model/progress';

// The sample has a grout approval (appr-grout) addressed to Dana, still waiting on her.
const GROUT = 'appr-grout';

async function setUp() {
  const repo = new LocalRepository('contractor', { clock: LocalRepository.sampleClock });
  const grout = approvals(await repo.listEvents(sampleProject.id)).find(
    (a) => a.approvalId === GROUT,
  )!;
  assert.ok(grout && grout.decision === undefined, 'sample: grout is pending');
  return { repo, grout };
}

test('the homeowner asks for changes; the contractor can withdraw; the question is closed', async () => {
  const { repo, grout } = await setUp();
  repo.setViewer(HOMEOWNER.userId);
  await repo.decideApproval(
    sampleProject.id,
    GROUT,
    'changes_requested',
    'I hate this one, lets get a new one',
  );
  repo.setViewer(CONTRACTOR.userId);
  let items = await repo.listItems(sampleProject.id);
  assert.equal(items.find((i) => i.id === grout.itemId)!.status, 'changes_requested');

  // The concierge card for it carries what the contractor needs to answer from the card.
  const members = await repo.listMembers(sampleProject.id);
  const card = allSuggestions({
    projectId: sampleProject.id,
    events: await repo.listEvents(sampleProject.id),
    items,
    members,
    now: NOW,
  }).find((s) => s.id.startsWith(`changes:${GROUT}`))!;
  assert.ok(card, 'change-request card exists');
  assert.equal(card.respond?.approvalId, GROUT);
  assert.equal(card.respond?.itemId, grout.itemId);
  assert.equal(card.respond?.who, 'Dana');
  assert.match(card.detail, /Reply, revise the item and ask again, or withdraw/);

  const withdrawn = await repo.decideApproval(
    sampleProject.id,
    GROUT,
    'withdrawn',
    'We will find another option.',
  );
  assert.equal(withdrawn.kind, 'approval_decided');
  assert.deepEqual(withdrawn.audience, [HOMEOWNER.userId], 'goes to the person who was asked');

  const events = await repo.listEvents(sampleProject.id);
  const after = approvals(events).find((a) => a.approvalId === GROUT)!;
  assert.equal(after.decision, 'withdrawn');
  assert.equal(after.decisionNote, 'We will find another option.');
  assert.ok(!openApprovals(events).some((a) => a.approvalId === GROUT), 'no longer open');
  items = await repo.listItems(sampleProject.id);
  assert.equal(
    items.find((i) => i.id === grout.itemId)!.status,
    'proposed',
    'item back to proposed',
  );

  // The concierge drops the card: there is nothing left to do about it.
  const cards = allSuggestions({ projectId: sampleProject.id, events, items, members, now: NOW });
  assert.ok(!cards.some((s) => s.id.startsWith(`changes:${GROUT}`)));
  assert.ok(!cards.some((s) => s.id === `approval:${GROUT}`));

  // Nothing follows a withdrawal — the homeowner cannot approve a question that was taken back.
  repo.setViewer(HOMEOWNER.userId);
  await assert.rejects(
    () => repo.decideApproval(sampleProject.id, GROUT, 'approved'),
    /Already decided/,
  );
  // But Dana sees the withdrawal and its note on her timeline.
  const hers = await repo.listEvents(sampleProject.id);
  const seen = hers.find((e) => e.id === withdrawn.id);
  assert.ok(seen && seen.body === 'We will find another option.');
});

test('a pending request can be withdrawn too; a homeowner cannot withdraw; approved is final', async () => {
  const { repo } = await setUp();
  repo.setViewer(HOMEOWNER.userId);
  await assert.rejects(
    () => repo.decideApproval(sampleProject.id, GROUT, 'withdrawn'),
    /Only the contractor/,
  );
  repo.setViewer(CONTRACTOR.userId);
  await repo.decideApproval(sampleProject.id, GROUT, 'withdrawn');
  assert.equal(
    approvals(await repo.listEvents(sampleProject.id)).find((a) => a.approvalId === GROUT)!
      .decision,
    'withdrawn',
  );

  // The glass approval: Dana approves, then the contractor tries to withdraw — refused.
  const GLASS = 'appr-glass';
  repo.setViewer(HOMEOWNER.userId);
  await repo.decideApproval(sampleProject.id, GLASS, 'approved');
  repo.setViewer(CONTRACTOR.userId);
  await assert.rejects(
    () => repo.decideApproval(sampleProject.id, GLASS, 'withdrawn'),
    /Already decided/,
  );
});

test('after a withdrawal, asking about the same item again is a new question, not round 2', async () => {
  const { repo, grout } = await setUp();
  await repo.decideApproval(sampleProject.id, GROUT, 'withdrawn');
  const events = await repo.listEvents(sampleProject.id);
  // What ContractorHome does: carry forward only an OPEN approval on the item.
  const open = openApprovals(events).find((a) => a.itemId === grout.itemId);
  assert.equal(open, undefined, 'nothing open to continue, so the form starts a fresh approvalId');
});
