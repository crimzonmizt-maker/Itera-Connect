// Repository over the schema in supabase/migrations/20260920_foundation.sql.
// Reads go through tables and the ic_items_v view (RLS and the view filter by role and
// audience); writes go through the ic_* functions.
import { newInviteCode } from '../model/format';
import { guessRoomType } from '../model/rooms';
import type {
  Id,
  Invitation,
  Item,
  NewEvent,
  Project,
  ProjectEvent,
  ProjectMember,
  Reply,
  Role,
  Room,
  Viewer,
  Decision,
} from '../model/types';
import type { ItemInput, NewProject, ProjectRepository, RoomInput } from './repository';
import { supabase } from './supabaseClient';

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : undefined;
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

function toProject(r: Row): Project {
  return {
    id: r.id as string,
    businessId: r.business_id as string,
    name: r.name as string,
    address: (r.address as string) ?? '',
    homeownerName: str(r.homeowner_name),
    mode: (r.mode as Project['mode']) ?? 'hybrid',
    showPrices: bool(r.show_prices) ?? true,
    startDate: str(r.start_date),
    targetDate: str(r.target_date),
    createdAt: r.created_at as string,
  };
}

function toRoom(r: Row): Room {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    type: str(r.type) as Room['type'],
    typeConfirmed: bool(r.type_confirmed) ?? false,
    createdAt: r.created_at as string,
  };
}

/** From ic_items_v: the view has already nulled what this viewer may not see. */
function toItem(r: Row): Item {
  const sourcing = {
    supplier: str(r.supplier),
    sku: str(r.sku),
    orderNumber: str(r.order_number),
    leadTimeDays: num(r.lead_time_days),
  };
  const team = { supplierCost: num(r.supplier_cost_cents), note: str(r.note) };
  const item: Item = {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    roomId: str(r.room_id),
    quantity: num(r.quantity) ?? 1,
    unit: str(r.unit),
    status: r.status as Item['status'],
    purchasedBy: (r.purchased_by as Item['purchasedBy']) ?? 'contractor',
    clientPrice: num(r.client_price_cents),
    sharePrice: bool(r.share_price) ?? undefined,
    shareSourcing: bool(r.share_sourcing) ?? undefined,
  };
  if (Object.values(sourcing).some((v) => v !== undefined)) item.sourcing = sourcing;
  if (Object.values(team).some((v) => v !== undefined)) item.team = team;
  return item;
}

function toReply(r: Row): Reply {
  return {
    id: r.id as string,
    at: r.at as string,
    authorId: r.author_id as string,
    authorName: r.author_name as string,
    authorRole: r.author_role as Role,
    body: r.body as string,
  };
}

function toEvent(r: Row, replies: Reply[]): ProjectEvent {
  const data = (r.data ?? {}) as Row;
  const base = {
    id: r.id as string,
    projectId: r.project_id as string,
    at: r.at as string,
    authorId: r.author_id as string,
    authorName: r.author_name as string,
    authorRole: r.author_role as Role,
    audience: (r.audience as string[]) ?? [],
    body: str(r.body),
    replies,
  };
  // `data` holds the kind-specific fields exactly as the app defines them.
  return { ...base, kind: r.kind, ...data } as unknown as ProjectEvent;
}

/** Split a NewEvent into the columns and the kind-specific json the database expects. */
function splitEvent(event: NewEvent) {
  const { projectId: _p, kind, audience, body, ...data } = event;
  return { kind, audience, body: body ?? null, data };
}

export class SupabaseRepository implements ProjectRepository {
  private viewerCache?: Viewer;

  async viewer(): Promise<Viewer> {
    if (this.viewerCache) return this.viewerCache;
    const db = supabase();
    const { data: auth } = await db.auth.getUser();
    const user = auth.user;
    if (!user) throw new Error('Not signed in.');
    const { data: biz } = await db
      .from('ic_business_members')
      .select('business_id')
      .eq('user_id', user.id)
      .limit(1);
    const businessId = biz?.[0]?.business_id as string | undefined;
    const { data: member } = await db
      .from('ic_project_members')
      .select('display_name')
      .eq('user_id', user.id)
      .limit(1);
    const displayName =
      (member?.[0]?.display_name as string | undefined) ??
      (user.user_metadata?.display_name as string | undefined) ??
      user.email ??
      'You';
    this.viewerCache = {
      userId: user.id,
      displayName,
      role: businessId ? 'contractor' : 'homeowner',
      businessId,
    };
    return this.viewerCache;
  }

  async listProjects(): Promise<Project[]> {
    const { data, error } = await supabase()
      .from('ic_projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => toProject(r as Row));
  }
  async getProject(projectId: Id) {
    const { data, error } = await supabase()
      .from('ic_projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw error;
    return data ? toProject(data as Row) : undefined;
  }
  async listMembers(projectId: Id): Promise<ProjectMember[]> {
    const { data, error } = await supabase()
      .from('ic_project_members')
      .select('*')
      .eq('project_id', projectId);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      projectId,
      userId: r.user_id as string,
      role: r.role as Role,
      displayName: r.display_name as string,
    }));
  }
  async listRooms(projectId: Id): Promise<Room[]> {
    const { data, error } = await supabase()
      .from('ic_rooms')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map((r) => toRoom(r as Row));
  }
  async listItems(projectId: Id): Promise<Item[]> {
    // The view decides, per row and per column, what this caller may see.
    const { data, error } = await supabase()
      .from('ic_items_v')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map((r) => toItem(r as Row));
  }
  async listEvents(projectId: Id): Promise<ProjectEvent[]> {
    const db = supabase();
    const { data: events, error } = await db
      .from('ic_events')
      .select('*')
      .eq('project_id', projectId)
      .order('at');
    if (error) throw error;
    const ids = (events ?? []).map((e) => e.id as string);
    const { data: replies } = ids.length
      ? await db.from('ic_replies').select('*').in('event_id', ids).order('at')
      : { data: [] };
    const byEvent = new Map<string, Reply[]>();
    for (const r of replies ?? []) {
      const list = byEvent.get(r.event_id as string) ?? [];
      list.push(toReply(r as Row));
      byEvent.set(r.event_id as string, list);
    }
    return (events ?? []).map((e) => toEvent(e as Row, byEvent.get(e.id as string) ?? []));
  }

  async appendEvent(event: NewEvent): Promise<ProjectEvent> {
    const { kind, audience, body, data } = splitEvent(event);
    const { data: id, error } = await supabase().rpc('ic_append_event', {
      p_project: event.projectId,
      p_kind: kind,
      p_audience: audience,
      p_body: body,
      p_data: data,
    });
    if (error) throw error;
    const { data: row } = await supabase()
      .from('ic_events')
      .select('*')
      .eq('id', id as string)
      .single();
    return toEvent(row as Row, []);
  }
  async reply(projectId: Id, eventId: Id, body: string): Promise<ProjectEvent> {
    const { error } = await supabase().rpc('ic_reply', { p_event: eventId, p_body: body });
    if (error) throw error;
    const events = await this.listEvents(projectId);
    const updated = events.find((e) => e.id === eventId);
    if (!updated) throw new Error('That conversation no longer exists.');
    return updated;
  }
  async decideApproval(projectId: Id, approvalId: Id, decision: Decision, note?: string) {
    // The database copies the audience from the request; what we pass here is ignored for homeowners.
    return this.appendEvent({
      projectId,
      kind: 'approval_decided',
      approvalId,
      decision,
      audience: [],
      body: note,
    });
  }
  async createInvitation(projectId: Id, email: string): Promise<Invitation> {
    const code = newInviteCode();
    const { data: id, error } = await supabase().rpc('ic_create_invitation', {
      p_project: projectId,
      p_email: email,
      p_code: code,
    });
    if (error) throw error;
    const { data: row } = await supabase()
      .from('ic_invitations')
      .select('*')
      .eq('id', id as string)
      .single();
    const r = row as Row;
    return {
      id: r.id as string,
      projectId,
      email: r.email as string,
      code: r.code as string,
      role: 'homeowner',
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
    };
  }

  async createProject(input: NewProject, businessName?: string): Promise<Project> {
    const db = supabase();
    const v = await this.viewer();
    let businessId = v.businessId;
    if (!businessId) {
      // First project for this contractor: create the business that will own it.
      const name = businessName?.trim() || `${v.displayName}'s business`;
      const { data, error } = await db.rpc('ic_create_business', { p_name: name });
      if (error) throw error;
      businessId = data as string;
      this.viewerCache = { ...v, role: 'contractor', businessId };
    }
    const { data: id, error } = await db.rpc('ic_create_project', {
      p_business: businessId,
      p_name: input.name,
      p_address: input.address,
      p_homeowner_name: input.homeownerName ?? null,
      p_mode: input.mode,
    });
    if (error) throw error;
    if (input.targetDate) {
      // Target date is optional and not part of the create function; set it in one follow-up.
      await db.rpc('ic_set_project_dates', {
        p_project: id,
        p_start: null,
        p_target: input.targetDate.slice(0, 10),
      });
    }
    const project = await this.getProject(id as string);
    if (!project) throw new Error('The project was created but could not be read back.');
    return project;
  }

  async upsertItem(projectId: Id, item: ItemInput): Promise<Item> {
    // ic_upsert_item takes the app's own Item shape, so nothing to translate here.
    const { data: id, error } = await supabase().rpc('ic_upsert_item', {
      p_project: projectId,
      p_item: item,
    });
    if (error) throw error;
    const { data: row, error: readError } = await supabase()
      .from('ic_items_v')
      .select('*')
      .eq('id', id as string)
      .single();
    if (readError) throw readError;
    return toItem(row as Row);
  }

  async upsertRoom(projectId: Id, room: RoomInput): Promise<Room> {
    // The one list of name hints lives in the app; the database stores the guess as unconfirmed.
    const { data: id, error } = await supabase().rpc('ic_upsert_room', {
      p_project: projectId,
      p_room: { ...room, guess: room.type ? undefined : guessRoomType(room.name) },
    });
    if (error) throw error;
    const { data: row, error: readError } = await supabase()
      .from('ic_rooms')
      .select('*')
      .eq('id', id as string)
      .single();
    if (readError) throw readError;
    return toRoom(row as Row);
  }

  subscribe(projectId: Id, onChange: () => void) {
    const channel = supabase()
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ic_events', filter: `project_id=eq.${projectId}` },
        onChange,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ic_replies' }, onChange)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ic_items', filter: `project_id=eq.${projectId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ic_rooms', filter: `project_id=eq.${projectId}` },
        onChange,
      )
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
  }

  /** Homeowner path: redeem the code the contractor gave them. Returns the project id. */
  static async acceptInvitation(code: string, displayName: string): Promise<Id> {
    const { data, error } = await supabase().rpc('ic_accept_invitation', {
      p_code: code.trim().toUpperCase(),
      p_display_name: displayName,
    });
    if (error) throw error;
    return data as string;
  }
}
