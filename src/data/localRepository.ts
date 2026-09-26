// In-memory repository with the fictional sample project. Used when Supabase is not
// configured, and by the tests. It applies the same visibility rules the database does,
// so a screen behaves identically against either backend.
import { addDays, newId, newInviteCode } from '../model/format';
import { guessRoomType } from '../model/rooms';
import type {
  Attachment,
  Id,
  Invitation,
  Item,
  NewEvent,
  Project,
  ProjectEvent,
  ProjectMember,
  Role,
  Room,
  Viewer,
  Decision,
} from '../model/types';
import { homeownerIds, modeDefaults, redactItems, visibleEvents } from '../model/visibility';
import type { ItemInput, NewProject, PickedFile, ProjectRepository, RoomInput } from './repository';
import {
  CONTRACTOR,
  HOMEOWNER,
  HOMEOWNER_2,
  NOW,
  sampleEvents,
  sampleItems,
  sampleMembers,
  sampleProject,
  sampleRooms,
} from './sample';

const HOMEOWNER_KINDS = new Set(['note', 'photo', 'approval_decided']);

export class LocalRepository implements ProjectRepository {
  private events: ProjectEvent[];
  private items: Item[];
  private rooms: Room[];
  private members: ProjectMember[];
  private projects: Project[];
  private invitations: Invitation[] = [];
  private listeners = new Set<() => void>();
  private who: Id;
  private clock: () => string;

  constructor(
    viewer: Role | Id = 'contractor',
    options: {
      clock?: () => string;
      events?: ProjectEvent[];
      items?: Item[];
      rooms?: Room[];
      project?: Project;
    } = {},
  ) {
    this.who =
      viewer === 'contractor'
        ? CONTRACTOR.userId
        : viewer === 'homeowner'
          ? HOMEOWNER.userId
          : viewer;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.events = structuredClone(options.events ?? sampleEvents);
    this.items = structuredClone(options.items ?? sampleItems);
    this.rooms = structuredClone(options.rooms ?? sampleRooms);
    this.projects = [structuredClone(options.project ?? sampleProject)];
    this.members = structuredClone(sampleMembers);
  }

  /** Development only: flip who is looking, without signing in. */
  setViewer(viewer: Role | Id) {
    this.who =
      viewer === 'contractor'
        ? CONTRACTOR.userId
        : viewer === 'homeowner'
          ? HOMEOWNER.userId
          : viewer;
    this.notify();
  }

  async viewer(): Promise<Viewer> {
    if (this.who === CONTRACTOR.userId) return { ...CONTRACTOR, role: 'contractor' };
    const person = this.who === HOMEOWNER_2.userId ? HOMEOWNER_2 : HOMEOWNER;
    return { ...person, role: 'homeowner' };
  }
  async listProjects(): Promise<Project[]> {
    const v = await this.viewer();
    // A homeowner sees the projects they are a member of; the team sees the business's projects.
    return this.projects.filter((p) =>
      v.role === 'contractor'
        ? p.businessId === v.businessId
        : this.members.some((m) => m.projectId === p.id && m.userId === v.userId),
    );
  }
  async getProject(projectId: Id) {
    return (await this.listProjects()).find((p) => p.id === projectId);
  }
  async listMembers(projectId: Id): Promise<ProjectMember[]> {
    return this.members.filter((m) => m.projectId === projectId);
  }
  async listRooms(projectId: Id): Promise<Room[]> {
    if (!(await this.getProject(projectId))) return [];
    return structuredClone(this.rooms.filter((r) => r.projectId === projectId));
  }
  async listItems(projectId: Id): Promise<Item[]> {
    const v = await this.viewer();
    const project = await this.getProject(projectId);
    if (!project) return [];
    return redactItems(
      v.role,
      project,
      this.items.filter((i) => i.projectId === projectId),
    );
  }
  async listEvents(projectId: Id): Promise<ProjectEvent[]> {
    const v = await this.viewer();
    return visibleEvents(
      v,
      this.events.filter((e) => e.projectId === projectId),
    );
  }

  async appendEvent(event: NewEvent): Promise<ProjectEvent> {
    const v = await this.viewer();
    let audience = event.audience;
    if (event.kind === 'approval_decided') {
      // A decision is seen by exactly the people who were asked, whoever posts it.
      const requested = this.latestRequest(event.projectId, event.approvalId);
      if (!requested) throw new Error('That approval was not found.');
      audience = requested.audience;
    } else if (v.role === 'homeowner') {
      if (!HOMEOWNER_KINDS.has(event.kind))
        throw new Error('A homeowner can post notes, photos and approval decisions only.');
      // A homeowner's post is seen by the team and by every homeowner on the project.
      audience = homeownerIds(this.members.filter((m) => m.projectId === event.projectId));
    } else {
      const valid = new Set(
        this.members.filter((m) => m.projectId === event.projectId).map((m) => m.userId),
      );
      if (audience.some((id) => !valid.has(id)))
        throw new Error('Audience must be members of this project.');
      if (event.kind === 'dismissal') audience = []; // the business's own bookkeeping
    }
    if (event.kind === 'approval_requested' && event.itemId) {
      // Asking again after "request changes": the item is under discussion once more.
      const item = this.items.find((i) => i.id === event.itemId && i.projectId === event.projectId);
      if (item && item.status === 'changes_requested') item.status = 'proposed';
    }
    const full: ProjectEvent = {
      ...event,
      audience,
      id: newId('ev'),
      at: this.clock(),
      authorId: v.userId,
      authorName: v.displayName,
      authorRole: v.role,
      replies: [],
    } as ProjectEvent;
    this.events.push(full);
    this.notify();
    return full;
  }

  async reply(projectId: Id, eventId: Id, body: string): Promise<ProjectEvent> {
    const v = await this.viewer();
    const event = this.events.find((e) => e.projectId === projectId && e.id === eventId);
    if (!event) throw new Error('That conversation no longer exists.');
    if (v.role === 'homeowner' && !event.audience.includes(v.userId))
      throw new Error('Not visible to you.');
    event.replies.push({
      id: newId('rp'),
      at: this.clock(),
      authorId: v.userId,
      authorName: v.displayName,
      authorRole: v.role,
      body,
    });
    this.notify();
    return event;
  }

  async decideApproval(projectId: Id, approvalId: Id, decision: Decision, note?: string) {
    const v = await this.viewer();
    const requested = this.latestRequest(projectId, approvalId);
    if (!requested) throw new Error('That approval was not found.');
    if (decision === 'withdrawn' && v.role !== 'contractor')
      throw new Error('Only the contractor can withdraw a request.');
    // "Already decided" applies to the current request only; a re-request supersedes the old
    // decision. Order in the spine decides, not timestamps (tests run with a fixed clock).
    const requestIndex = this.events.indexOf(requested);
    const current = this.events.find(
      (e, i) => i > requestIndex && e.kind === 'approval_decided' && e.approvalId === approvalId,
    );
    // The one decision that may follow another: the contractor withdrawing after "change it".
    // Nothing follows "approved" or "withdrawn" — those close the question.
    if (
      current &&
      !(
        decision === 'withdrawn' &&
        current.kind === 'approval_decided' &&
        current.decision === 'changes_requested'
      )
    )
      throw new Error('Already decided.');
    if (requested.itemId) {
      const item = this.items.find((i) => i.id === requested.itemId);
      // Only items still under discussion move; something already ordered is not un-ordered
      // by a late "request changes".
      if (item && (item.status === 'proposed' || item.status === 'changes_requested'))
        item.status =
          decision === 'approved'
            ? 'approved'
            : decision === 'withdrawn'
              ? 'proposed'
              : 'changes_requested';
    }
    return this.appendEvent({
      projectId,
      kind: 'approval_decided',
      approvalId,
      decision,
      audience: requested.audience,
      body: note,
    });
  }

  /** The most recent (re)request for an approval — the one a decision answers. */
  private latestRequest(projectId: Id, approvalId: Id) {
    let found: Extract<ProjectEvent, { kind: 'approval_requested' }> | undefined;
    for (const e of this.events)
      if (
        e.projectId === projectId &&
        e.kind === 'approval_requested' &&
        e.approvalId === approvalId
      )
        found = e;
    return found;
  }

  async createInvitation(projectId: Id, email: string): Promise<Invitation> {
    const v = await this.viewer();
    if (v.role !== 'contractor') throw new Error('Only the contractor can invite.');
    const now = this.clock();
    const invitation: Invitation = {
      id: newId('inv'),
      projectId,
      email: email.trim().toLowerCase(),
      code: newInviteCode(),
      role: 'homeowner',
      createdAt: now,
      expiresAt: addDays(now, 14),
    };
    this.invitations.push(invitation);
    this.notify();
    return invitation;
  }

  async createProject(input: NewProject, _businessName?: string): Promise<Project> {
    const v = await this.viewer();
    if (v.role !== 'contractor') throw new Error('Only the contractor can create a project.');
    if (!input.name.trim()) throw new Error('Give the project a name.');
    const now = this.clock();
    const project: Project = {
      id: newId('proj'),
      businessId: v.businessId ?? newId('biz'),
      name: input.name.trim(),
      address: input.address.trim(),
      homeownerName: input.homeownerName?.trim() || undefined,
      mode: input.mode,
      showPrices: modeDefaults(input.mode).showPrices,
      startDate: now,
      targetDate: input.targetDate,
      createdAt: now,
    };
    this.projects.push(project);
    this.members.push({
      projectId: project.id,
      userId: v.userId,
      role: 'contractor',
      displayName: v.displayName,
    });
    this.notify();
    return project;
  }

  async upsertItem(projectId: Id, input: ItemInput): Promise<Item> {
    const v = await this.viewer();
    if (v.role !== 'contractor') throw new Error('Only the contractor can edit items.');
    const project = await this.getProject(projectId);
    if (!project) throw new Error('That project was not found.');
    if (!input.name.trim()) throw new Error('Give the item a name.');
    const { id, ...fields } = input;
    const existing = id
      ? this.items.find((i) => i.id === id && i.projectId === projectId)
      : undefined;
    if (id && !existing) throw new Error('That item was not found.');
    if (
      fields.roomId !== undefined &&
      !this.rooms.some((r) => r.id === fields.roomId && r.projectId === projectId)
    )
      throw new Error('That room is not on this project.');
    const item: Item = {
      ...fields,
      id: existing?.id ?? newId('item'),
      projectId,
      name: input.name.trim(),
    };
    if (existing) Object.assign(existing, item);
    else this.items.push(item);
    this.notify();
    return structuredClone(item);
  }

  async upsertRoom(projectId: Id, input: RoomInput): Promise<Room> {
    const v = await this.viewer();
    if (v.role !== 'contractor') throw new Error('Only the contractor can edit rooms.');
    if (!(await this.getProject(projectId))) throw new Error('That project was not found.');
    const name = input.name.trim();
    if (!name) throw new Error('Give the room a name.');
    const existing = input.id
      ? this.rooms.find((r) => r.id === input.id && r.projectId === projectId)
      : undefined;
    if (input.id && !existing) throw new Error('That room was not found.');
    const duplicate = this.rooms.find(
      (r) =>
        r.projectId === projectId &&
        r.id !== existing?.id &&
        r.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new Error(`There is already a room called “${duplicate.name}”.`);
    // A type the contractor typed is their word. Otherwise keep a confirmed type, or guess.
    const room: Room = {
      id: existing?.id ?? newId('room'),
      projectId,
      name,
      type: input.type ?? (existing?.typeConfirmed ? existing.type : guessRoomType(name)),
      typeConfirmed: input.type !== undefined || (existing?.typeConfirmed ?? false),
      createdAt: existing?.createdAt ?? this.clock(),
    };
    if (existing) Object.assign(existing, room);
    else this.rooms.push(room);
    this.notify();
    return structuredClone(room);
  }

  async setProjectDates(projectId: Id, start: string | null, target: string | null) {
    const v = await this.viewer();
    if (v.role !== 'contractor') throw new Error('Only the contractor can change dates.');
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('That project was not found.');
    if (start) project.startDate = start;
    if (target) project.targetDate = target;
    this.notify();
  }

  async acceptInvitation(code: string, _displayName: string): Promise<Id> {
    const v = await this.viewer();
    const invitation = this.invitations.find(
      (i) => i.code === code.trim().toUpperCase() && !i.acceptedAt,
    );
    if (!invitation) throw new Error('IC_INVITE_INVALID');
    invitation.acceptedAt = this.clock();
    if (!this.members.some((m) => m.projectId === invitation.projectId && m.userId === v.userId))
      this.members.push({
        projectId: invitation.projectId,
        userId: v.userId,
        role: 'homeowner',
        displayName: v.displayName,
      });
    this.notify();
    return invitation.projectId;
  }

  /** The sample keeps nothing: the picked file's own address stands in for the stored copy. */
  async uploadFile(_projectId: Id, file: PickedFile): Promise<Attachment> {
    return { path: file.uri, name: file.name, mimeType: file.mimeType, size: file.size };
  }
  async fileUrl(path: string) {
    return path;
  }

  subscribe(_projectId: Id, onChange: () => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
  private notify() {
    for (const l of this.listeners) l();
  }

  /** For tests. */
  static sampleClock = () => NOW;
}
