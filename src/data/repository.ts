import type {
  EngagementMode,
  Id,
  Invitation,
  Item,
  NewEvent,
  Project,
  ProjectEvent,
  ProjectMember,
  Viewer,
} from '../model/types';

/** What the contractor fills in to start a project. Mode sets purchasing and price defaults. */
export type NewProject = {
  name: string;
  address: string;
  homeownerName?: string;
  mode: EngagementMode;
  targetDate?: string;
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
  listItems(projectId: Id): Promise<Item[]>;
  listEvents(projectId: Id): Promise<ProjectEvent[]>;
  /** Homeowners may only post to an audience that includes themselves; the repository enforces it. */
  appendEvent(event: NewEvent): Promise<ProjectEvent>;
  reply(projectId: Id, eventId: Id, body: string): Promise<ProjectEvent>;
  decideApproval(
    projectId: Id,
    approvalId: Id,
    decision: 'approved' | 'changes_requested',
    note?: string,
  ): Promise<ProjectEvent>;
  createInvitation(projectId: Id, email: string): Promise<Invitation>;
  /** Contractor only. A contractor with no business yet gets one created under `businessName`. */
  createProject(input: NewProject, businessName?: string): Promise<Project>;
  /** Contractor only. Team fields are stored; the homeowner's copy is redacted on read. */
  upsertItem(projectId: Id, item: ItemInput): Promise<Item>;
  /** Called when data changes from this device or another. Returns an unsubscribe. */
  subscribe(projectId: Id, onChange: () => void): () => void;
}
