import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRepository } from '../src/data/localRepository';
import { sampleProject, sampleRooms } from '../src/data/sample';
import { guessRoomType, roomsNeedingType } from '../src/model/rooms';

test('the name suggests a type when it can, and says nothing when it cannot', () => {
  assert.equal(guessRoomType('Primary bath'), 'bathroom');
  assert.equal(guessRoomType('Jack and Jill upstairs'), 'bathroom');
  assert.equal(guessRoomType('Kitchen'), 'kitchen');
  assert.equal(guessRoomType('Guest bedroom'), 'bedroom');
  assert.equal(guessRoomType('Mudroom'), 'laundry');
  assert.equal(guessRoomType('Back deck'), 'exterior');
  assert.equal(guessRoomType('The back room'), undefined, 'no guess is better than a wrong one');
});

test('a room the contractor names is created with a guess, marked as a guess', async () => {
  const repo = new LocalRepository('contractor', {
    clock: LocalRepository.sampleClock,
  });
  const room = await repo.upsertRoom(sampleProject.id, { name: 'Hall bath' });
  assert.equal(room.type, 'bathroom');
  assert.equal(room.typeConfirmed, false, 'a guess is not the contractor’s word');

  const vague = await repo.upsertRoom(sampleProject.id, {
    name: 'The back room',
  });
  assert.equal(vague.type, undefined);
  assert.equal(vague.typeConfirmed, false);

  const rooms = await repo.listRooms(sampleProject.id);
  assert.deepEqual(
    roomsNeedingType(rooms).map((r) => r.name),
    ['Hall bath', 'The back room'],
    'both still need the contractor to confirm; the sample room does not',
  );
});

test('a type the contractor gives is confirmed and survives a rename', async () => {
  const repo = new LocalRepository('contractor', {
    clock: LocalRepository.sampleClock,
  });
  const room = await repo.upsertRoom(sampleProject.id, {
    name: 'The back room',
    type: 'bedroom',
  });
  assert.equal(room.typeConfirmed, true);
  const renamed = await repo.upsertRoom(sampleProject.id, {
    id: room.id,
    name: 'Nursery',
  });
  assert.equal(renamed.type, 'bedroom', 'a confirmed type is not re-guessed from the new name');
  assert.equal(renamed.typeConfirmed, true);
});

test('rooms are unique by name on a project, and only the contractor edits them', async () => {
  const repo = new LocalRepository('contractor', {
    clock: LocalRepository.sampleClock,
  });
  await assert.rejects(
    repo.upsertRoom(sampleProject.id, { name: 'primary bath' }),
    /already a room/,
  );
  await assert.rejects(repo.upsertRoom(sampleProject.id, { name: '  ' }), /name/);
  const asHomeowner = new LocalRepository('homeowner', {
    clock: LocalRepository.sampleClock,
  });
  await assert.rejects(asHomeowner.upsertRoom(sampleProject.id, { name: 'Kitchen' }), /contractor/);
});

test('an item may only point at a room on its own project; everyone sees the room list', async () => {
  const repo = new LocalRepository('contractor', {
    clock: LocalRepository.sampleClock,
  });
  const base = {
    quantity: 1,
    status: 'proposed' as const,
    purchasedBy: 'contractor' as const,
  };
  await assert.rejects(
    repo.upsertItem(sampleProject.id, {
      ...base,
      name: 'Mirror',
      roomId: 'room-elsewhere',
    }),
    /not on this project/,
  );
  const ok = await repo.upsertItem(sampleProject.id, {
    ...base,
    name: 'Mirror',
    roomId: sampleRooms[0]!.id,
  });
  assert.equal(ok.roomId, 'room-primary-bath');

  const asHomeowner = new LocalRepository('homeowner', {
    clock: LocalRepository.sampleClock,
  });
  const rooms = await asHomeowner.listRooms(sampleProject.id);
  assert.deepEqual(
    rooms.map((r) => r.name),
    ['Primary bath'],
    'rooms have nothing to hide',
  );
  const items = await asHomeowner.listItems(sampleProject.id);
  assert.ok(items.every((i) => i.roomId === 'room-primary-bath'));
});
