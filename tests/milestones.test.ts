import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRepository } from '../src/data/localRepository';
import { HOMEOWNER, sampleProject } from '../src/data/sample';
import { projectProgress } from '../src/model/progress';
import { homeownerIds } from '../src/model/visibility';

test('an Update on a milestone is news, not a status change', async () => {
  const repo = new LocalRepository('contractor', { clock: LocalRepository.sampleClock });
  const members = await repo.listMembers(sampleProject.id);
  const before = projectProgress(await repo.listEvents(sampleProject.id));
  const current = before.current!;
  assert.equal(current.status, 'planned', 'sample: Tile floor & walls is next up');

  await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'milestone',
    title: current.title,
    status: 'update',
    body: 'Tile arrives Thursday; walls first.',
    audience: homeownerIds(members),
  });
  let after = projectProgress(await repo.listEvents(sampleProject.id));
  assert.equal(
    after.milestones.find((m) => m.title === current.title)!.status,
    'planned',
    'an update on a planned milestone does not start it',
  );
  assert.equal(after.done, before.done, 'nothing was finished');

  await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'milestone',
    title: current.title,
    status: 'started',
    audience: homeownerIds(members),
  });
  await repo.appendEvent({
    projectId: sampleProject.id,
    kind: 'milestone',
    title: current.title,
    status: 'update',
    body: 'Floor grouted.',
    audience: homeownerIds(members),
  });
  after = projectProgress(await repo.listEvents(sampleProject.id));
  assert.equal(
    after.milestones.find((m) => m.title === current.title)!.status,
    'started',
    'an update on a started milestone leaves it in progress',
  );

  // The homeowner sees the update as its own entry, with the note.
  repo.setViewer(HOMEOWNER.userId);
  const seen = (await repo.listEvents(sampleProject.id)).filter(
    (e) => e.kind === 'milestone' && e.status === 'update',
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.body, 'Floor grouted.');
});
