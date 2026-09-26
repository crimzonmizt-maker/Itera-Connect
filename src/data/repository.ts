import type {
  Attachment,
  EngagementMode,
  Id,
  Invitation,
  Item,
  NewEvent,
  Project,
  ProjectEvent,
  ProjectMember,
  Room,
  RoomType,
  Viewer,
  Decision,
} from '../model/types';

/** What the contractor fills in to start a project. Mode sets purchasing and price defaults. */
export type NewProject = {
  name: string;
  address: string;
  homeownerName?: string;
  mode: EngagementMode;
  targetDate?: string;
};

/**
 * A room as the contractor edits it. No id = create. A type given here is the contractor's
 * word, so it is confirmed; leave it out and the repository guesses from the name (unconfirmed).
 */
export type RoomInput = { id?: Id; name: string; type?: RoomType };

/**
 * A file the person picked, before it is uploaded. `file` is set on the web (the browser's own
 * File); on a phone the bytes are read from `uri`.
 */
export type PickedFile = {
  name: string;
  mimeType: string;
  size?: number;
  uri: string;
  file?: Blob;
};

/** An item as the contractor edits it. No id = create; with id = update that item. */
export type ItemInput = Omit<Item, 'id' | 'projectId'> & { id?: Id };

/**
 * Everything a screen may ask for. Screens never touch storage or Supabase directly.
 * Both implementations return data ALREADY filtered for the viewer, so a homeowner
 * screen cannot accidentally render a team-only note or a supplier cost.
 */
export interface ProjectRepository {
  viewer(): Promise<Viewer>;
  listProjects(): Promise<Project[]>;
  getProject(projectId: Id): Promise<Project | undefined>;
  listMembers(projectId: Id): Promise<ProjectMember[]>;
  /** Rooms have nothing to hide: every member of the project sees the same list. */
  listRooms(projectId: Id): Promise<Room[]>;
  listItems(projectId: Id): Promise<Item[]>;
  listEvents(projectId: Id): Promise<ProjectEvent[]>;
  /** Homeowners may only post to an audience that includes themselves; the repository enforces it. */
  appendEvent(event: NewEvent): Promise<ProjectEvent>;
  reply(projectId: Id, eventId: Id, body: string): Promise<ProjectEvent>;
  /**
   * Answer the latest request for an approval. A homeowner who was asked may approve or request
   * changes once per request; the contractor may withdraw a request that is pending or awaiting
   * their revision. The item under discussion follows: approved / changes_requested / back to
   * proposed.
   */
  decideApproval(
    projectId: Id,
    approvalId: Id,
    decision: Decision,
    note?: string,
  ): Promise<ProjectEvent>;
  createInvitation(projectId: Id, email: string): Promise<Invitation>;
  /** Contractor only. A contractor with no business yet gets one created under `businessName`. */
  createProject(input: NewProject, businessName?: string): Promise<Project>;
  /** Contractor only. Team fields are stored; the homeowner's copy is redacted on read. */
  upsertItem(projectId: Id, item: ItemInput): Promise<Item>;
  /** Contractor only. Creating a room with a type-less name guesses the type and marks it unconfirmed. */
  upsertRoom(projectId: Id, room: RoomInput): Promise<Room>;
  /** Contractor only. Null leaves a date as it is. */
  setProjectDates(projectId: Id, start: string | null, target: string | null): Promise<void>;
  /** Redeem an invitation code as the signed-in person. Returns the project it opens. */
  acceptInvitation(code: string, displayName: string): Promise<Id>;
  /** Store a file under the project. It is readable once an entry that points at it is posted. */
  uploadFile(projectId: Id, file: PickedFile): Promise<Attachment>;
  /** A short-lived address to show or download a stored file. */
  fileUrl(path: string): Promise<string>;
  /** Called when data changes from this device or another. Returns an unsubscribe. */
  subscribe(projectId: Id, onChange: () => void): () => void;
}
