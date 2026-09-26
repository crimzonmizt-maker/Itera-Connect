import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRepository } from '../src/data/localRepository';
import { HOMEOWNER, HOMEOWNER_2, NOW, sampleProject } from '../src/data/sample';
import { friendlyError } from '../src/model/errors';
import { parseWhen, shortDate } from '../src/model/format';
import { roleOn, type Viewer } from '../src/model/types';

const noon = (iso: string | undefined) => (iso ? new Date(iso).getHours() : undefined);

test('dates are read the way people type them, at noon so a time zone cannot shift the day', () => {
  const now = new Date(2026, 8, 25, 9).toISOString(); // 25 Sep 2026, 9am local
  assert.equal(shortDate(parseWhen('2026-10-14', now)!), 'Oct 14');
  assert.equal(shortDate(parseWhen('10/14/2026', now)!), 'Oct 14');
  assert.equal(shortDate(parseWhen('10/14', now)!), 'Oct 14');
  assert.equal(noon(parseWhen('10/14', now)), 12);
  assert.equal(shortDate(parseWhen('7', now)!), 'Oct 2');
  // A month/day that has already passed this year means next year.
  assert.equal(new Date(parseWhen('1/5', now)!).getFullYear(), 2027);
  assert.equal(parseWhen('', now), undefined);
  assert.equal(parseWhen('next tuesday', now), undefined);
  assert.equal(parseWhen('2026-02-30', now), undefined, 'no such day');
});

test('database and sign-in codes become sentences a person can act on', () => {
  assert.match(friendlyError(new Error('IC_PLAN_LIMIT')), /plan/);
  assert.match(friendlyError({ message: 'IC_ALREADY_DECIDED' }), /already been answered/);
  assert.match(friendlyError(new Error('Invalid login credentials')), /did not match/);
  assert.match(friendlyError(new Error('new row violates row-level security policy')), /access/);
  assert.match(friendlyError(new Error('Failed to fetch')), /connect/);
  assert.equal(friendlyError(new Error('xyzzy'), 'Fallback.'), 'Fallback.');
  // Nothing raw leaks through the fallback.
  assert.doesNotMatch(friendlyError(new Error('IC_SOMETHING_NEW')), /IC_/);
});

test('the role is per project: a contractor invited to someone else’s job is a homeowner there', () => {
  const mike: Viewer = { userId: 'u1', displayName: 'Mike', role: 'contractor', businessId: 'b1' };
  assert.equal(roleOn(mike, { businessId: 'b1' }), 'contractor');
  assert.equal(roleOn(mike, { businessId: 'b2' }), 'homeowner');
  const dana: Viewer = { userId: 'u2', displayName: 'Dana', role: 'homeowner' };
  assert.equal(roleOn(dana, { businessId: 'b1' }), 'homeowner');
  assert.equal(roleOn(mike, undefined), 'contractor');
});

test('an invitation code opens the project once, for the person who redeems it', async () => {
  const repo = new LocalRepository('contractor', { clock: () => NOW });
  const inv = await repo.createInvitation(sampleProject.id, 'new@example.com');
  // The sample treats any other id as Dana; what matters here is that the code works once.
  repo.setViewer('someone-new');
  assert.equal(await repo.acceptInvitation(inv.code.toLowerCase(), 'Pat'), sampleProject.id);
  await assert.rejects(repo.acceptInvitation(inv.code, 'Pat'), /IC_INVITE_INVALID/);
  repo.setViewer(HOMEOWNER_2.userId);
  await assert.rejects(repo.acceptInvitation('ZZZZZZZZ', 'Sam'), /IC_INVITE_INVALID/);
});

test('files travel with the entry and only reach its audience', async () => {
  const repo = new LocalRepository('contractor', { clock: () => NOW });
  const [spec] = [
    await repo.uploadFile(sampleProject.id, {
      name: 'faucet spec.pdf',
      mimeType: 'application/pdf',
      uri: 'blob:spec',
    }),
  ];
  await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'note',
    body: 'Spec sheet',
    attachments: [spec!],
    audience: [HOMEOWNER.userId],
  });
  repo.setViewer(HOMEOWNER.userId);
  const dana = await repo.listEvents(sampleProject.id);
  assert.ok(
    dana.some((e) => e.attachments?.[0]?.name === 'faucet spec.pdf'),
    'Dana sees it',
  );
  repo.setViewer(HOMEOWNER_2.userId);
  const sam = await repo.listEvents(sampleProject.id);
  assert.ok(!sam.some((e) => e.attachments?.length), 'Sam was not in the audience');
});

test('project dates can be set later, and only by the contractor', async () => {
  const repo = new LocalRepository('contractor', { clock: () => NOW });
  await repo.setProjectDates(sampleProject.id, null, '2026-12-01T12:00:00.000Z');
  assert.equal((await repo.getProject(sampleProject.id))?.targetDate, '2026-12-01T12:00:00.000Z');
  repo.setViewer(HOMEOWNER.userId);
  await assert.rejects(repo.setProjectDates(sampleProject.id, null, '2027-01-01'), /contractor/);
});
