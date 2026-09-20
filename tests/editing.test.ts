import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRepository } from '../src/data/localRepository';
import { HOMEOWNER, sampleProject } from '../src/data/sample';
import { moneyInput, parseMoney } from '../src/model/format';

test('parseMoney reads what people type and refuses what it cannot', () => {
  assert.equal(parseMoney('1840'), 184000);
  assert.equal(parseMoney('1,840.00'), 184000);
  assert.equal(parseMoney('$1,840.5'), 184050);
  assert.equal(parseMoney(' 66 '), 6600);
  assert.equal(parseMoney('0'), 0);
  assert.equal(parseMoney(''), undefined, 'blank means "no price", not zero');
  assert.equal(parseMoney('abc'), undefined);
  assert.equal(parseMoney('1.234'), undefined, 'three decimals is a typo, not a price');
  assert.equal(parseMoney('-5'), undefined);
  assert.equal(moneyInput(184000), '1840.00');
  assert.equal(moneyInput(undefined), '');
});

test('contractor adds and edits an item; the homeowner copy is redacted on read', async () => {
  const repo = new LocalRepository('contractor', { clock: LocalRepository.sampleClock });
  const added = await repo.upsertItem(sampleProject.id, {
    name: 'Matte black pulls',
    quantity: 6,
    unit: 'each',
    status: 'proposed',
    purchasedBy: 'contractor',
    clientPrice: 18000,
    sourcing: { supplier: 'Top Knobs', sku: 'TK-MB-5' },
    team: { supplierCost: 11400, note: 'order with vanity' },
  });
  assert.ok(added.id.startsWith('item-'));
  assert.equal((await repo.listItems(sampleProject.id)).length, 5);

  const edited = await repo.upsertItem(sampleProject.id, {
    ...added,
    status: 'ordered',
    sourcing: { ...added.sourcing, orderNumber: 'TK-991' },
  });
  assert.equal(edited.id, added.id, 'editing keeps the id');
  assert.equal(edited.status, 'ordered');
  assert.equal((await repo.listItems(sampleProject.id)).length, 5, 'edit did not duplicate');

  repo.setViewer(HOMEOWNER.userId);
  const dana = (await repo.listItems(sampleProject.id)).find((i) => i.id === added.id)!;
  assert.equal(dana.clientPrice, 18000, 'hybrid shows the price');
  assert.equal(dana.sourcing, undefined, 'contractor-supplied: no supplier or SKU');
  assert.equal(dana.team, undefined, 'never the cost or note');

  await assert.rejects(
    () => repo.upsertItem(sampleProject.id, { ...added, name: 'x' }),
    /Only the contractor/,
  );
  await assert.rejects(
    () =>
      repo.upsertItem(sampleProject.id, {
        name: '',
        quantity: 1,
        status: 'proposed',
        purchasedBy: 'contractor',
      }),
    /Only the contractor/,
  );
});

test('upsertItem refuses a blank name and an unknown id', async () => {
  const repo = new LocalRepository('contractor');
  await assert.rejects(
    () =>
      repo.upsertItem(sampleProject.id, {
        name: '  ',
        quantity: 1,
        status: 'proposed',
        purchasedBy: 'contractor',
      }),
    /name/,
  );
  await assert.rejects(
    () =>
      repo.upsertItem(sampleProject.id, {
        id: 'item-nope',
        name: 'x',
        quantity: 1,
        status: 'proposed',
        purchasedBy: 'contractor',
      }),
    /not found/,
  );
});

test('createProject: contractor only; mode sets the price default; homeowners do not see it', async () => {
  const repo = new LocalRepository('contractor', { clock: LocalRepository.sampleClock });
  const allIn = await repo.createProject({ name: 'Kitchen', address: '1 Main St', mode: 'all_in' });
  assert.equal(allIn.showPrices, false, 'all-in hides prices by default');
  const labor = await repo.createProject({ name: 'Deck', address: '', mode: 'labor_only' });
  assert.equal(labor.showPrices, true);
  assert.equal((await repo.listProjects()).length, 3);
  assert.equal(
    (await repo.listMembers(allIn.id)).length,
    1,
    'the contractor is a member of the new project',
  );

  // Items on the new project follow its mode.
  const item = await repo.upsertItem(allIn.id, {
    name: 'Range hood',
    quantity: 1,
    status: 'proposed',
    purchasedBy: 'contractor',
    clientPrice: 90000,
  });
  assert.equal(item.projectId, allIn.id);

  repo.setViewer(HOMEOWNER.userId);
  const mine = await repo.listProjects();
  assert.deepEqual(
    mine.map((p) => p.id),
    [sampleProject.id],
    'Dana was not invited to the new ones',
  );
  assert.equal(await repo.getProject(allIn.id), undefined);
  assert.deepEqual(await repo.listItems(allIn.id), [], 'and cannot read its items');
  await assert.rejects(
    () => repo.createProject({ name: 'x', address: '', mode: 'hybrid' }),
    /Only the contractor/,
  );
});
