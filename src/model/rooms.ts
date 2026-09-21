// Rooms: the contractor's free-text name on one side, the type the app reasons with on the
// other. The guess here is only a starting point — it is shown as a guess until confirmed.
import type { Id, Room, RoomType } from './types';

export const ROOM_TYPES: { value: RoomType; label: string }[] = [
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'living', label: 'Living space' },
  { value: 'laundry', label: 'Laundry' },
  { value: 'basement', label: 'Basement' },
  { value: 'garage', label: 'Garage' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'other', label: 'Other' },
];

export const roomTypeLabel = (type: RoomType | undefined) =>
  ROOM_TYPES.find((t) => t.value === type)?.label;

/** Words that, appearing in a room's name, make its type a safe guess. First match wins. */
const HINTS: [RegExp, RoomType][] = [
  [
    /\b(bath|bathroom|ensuite|en-suite|powder|shower|jack\s*(and|&|n)\s*jill|master bath|primary bath)\b/i,
    'bathroom',
  ],
  [/\b(kitchen|kitchenette|pantry|butler)\b/i, 'kitchen'],
  [/\b(bed|bedroom|nursery|guest room|primary suite|master suite)\b/i, 'bedroom'],
  [
    /\b(living|family|great room|den|dining|lounge|office|study|hall|hallway|foyer|entry|stairs?|loft)\b/i,
    'living',
  ],
  [/\b(laundry|utility|mud ?room)\b/i, 'laundry'],
  [/\b(basement|cellar)\b/i, 'basement'],
  [/\b(garage|carport|shop|workshop)\b/i, 'garage'],
  [/\b(exterior|outside|patio|deck|porch|siding|roof|yard|driveway|fence|barn)\b/i, 'exterior'],
];

/** What the name suggests, or undefined when it says nothing ("the back room"). */
export function guessRoomType(name: string): RoomType | undefined {
  for (const [re, type] of HINTS) if (re.test(name)) return type;
  return undefined;
}

export const roomById = (rooms: Room[], id: Id | undefined) =>
  id === undefined ? undefined : rooms.find((r) => r.id === id);

export const roomName = (rooms: Room[], id: Id | undefined) => roomById(rooms, id)?.name;

/** Rooms whose type the app still has to ask about: nothing guessed, or a guess unconfirmed. */
export const roomsNeedingType = (rooms: Room[]) => rooms.filter((r) => !r.typeConfirmed);
