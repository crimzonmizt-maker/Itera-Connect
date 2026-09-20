-- Itera Connect foundation.
--
-- A contractor's BUSINESS owns PROJECTS. People become PROJECT MEMBERS with a role.
-- Everything that happens is a PROJECT EVENT addressed to an AUDIENCE (the member ids who may
-- see it; empty = team only). ITEMS carry everything in one table; homeowners read them through
-- the ic_items_v view, which nulls the columns they may not see based on who BUYS the item and
-- what the contractor chose to share.
--
-- Decisions from the 19 Sep review with Hanna:
--   • engagement mode per project (all_in / labor_only / hybrid) with an override per item
--   • sharing must always say WHO — hence an audience of ids, not a shared/team flag
--   • the homeowner sees supplier + SKU only for things they have to go and buy
--   • documents that leave by e-mail are recorded (document_sent) so the record is complete
--
-- Style follows the existing Itera migrations: RLS on every table, writes through
-- SECURITY DEFINER functions that re-check the caller, no service-role key in any client.

begin;

create extension if not exists pgcrypto;

-- ─────────────────────────── businesses & membership ───────────────────────────
create table public.ic_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.ic_business_members (
  business_id uuid not null references public.ic_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.ic_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.ic_businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  address text not null default '',
  homeowner_name text,
  -- Who buys materials by default. all_in: contractor, prices private. labor_only: homeowner.
  mode text not null default 'hybrid' check (mode in ('all_in','labor_only','hybrid')),
  -- Whether client prices on CONTRACTOR-supplied items are visible to the homeowner.
  show_prices boolean not null default true,
  start_date date,
  target_date date,
  created_at timestamptz not null default now()
);
create index on public.ic_projects(business_id);

-- Who may open a project, and as what. Contractors are members through their business
-- (see ic_is_team); this table is for homeowners and any per-project guest.
create table public.ic_project_members (
  project_id uuid not null references public.ic_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('contractor','homeowner')),
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.ic_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ic_projects(id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  code text not null check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  role text not null default 'homeowner' check (role = 'homeowner'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  unique (project_id, code)
);
create index on public.ic_invitations(email);

-- ─────────────────────────────────── items ─────────────────────────────────────
-- One row per item. Which columns a homeowner may see is decided by ic_items_v, never by the app.
create table public.ic_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ic_projects(id) on delete cascade,
  name text not null,
  room text,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text,
  status text not null default 'proposed' check (status in ('proposed','changes_requested','approved','ordered','delivered','installed')),
  -- who goes and buys it
  purchased_by text not null default 'contractor' check (purchased_by in ('contractor','homeowner')),
  -- what the homeowner pays; null when it is simply "in the contract"
  client_price_cents bigint check (client_price_cents is null or client_price_cents >= 0),
  -- per-item overrides of the project defaults (null = follow the default)
  share_price boolean,
  share_sourcing boolean,
  -- sourcing: visible to whoever has to buy it
  supplier text,
  sku text,
  order_number text,
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  -- team: never visible to a homeowner
  supplier_cost_cents bigint check (supplier_cost_cents is null or supplier_cost_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ic_items(project_id);

-- ─────────────────────────────────── events ────────────────────────────────────
create table public.ic_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ic_projects(id) on delete cascade,
  -- clock_timestamp, not now(): two entries written in one transaction must still be ordered,
  -- because "does this decision answer the latest request" is decided by `at`.
  at timestamptz not null default clock_timestamp(),
  author_id uuid not null references auth.users(id),
  author_name text not null,
  author_role text not null check (author_role in ('contractor','homeowner')),
  -- The member ids who may see this entry. Empty = the business team only.
  audience uuid[] not null default '{}',
  kind text not null check (kind in ('note','milestone','schedule','order','delivery','approval_requested','approval_decided','photo','document_sent','dismissal')),
  body text,
  -- kind-specific fields, shape-checked by ic_append_event
  data jsonb not null default '{}'::jsonb,
  check (octet_length(data::text) <= 16384)
);
create index on public.ic_events(project_id, at);
create index on public.ic_events using gin (audience);

create table public.ic_replies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ic_events(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  author_id uuid not null references auth.users(id),
  author_name text not null,
  author_role text not null check (author_role in ('contractor','homeowner')),
  body text not null check (length(body) between 1 and 4000)
);
create index on public.ic_replies(event_id, at);

-- ───────────────────────────────── access helpers ─────────────────────────────
-- Is the caller on the business team that owns this project?
create or replace function public.ic_is_team(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ic_projects p
    join public.ic_business_members m on m.business_id = p.business_id
    where p.id = p_project and m.user_id = (select auth.uid())
  );
$$;

-- Is the caller a homeowner member of this project?
create or replace function public.ic_is_homeowner(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ic_project_members pm
    where pm.project_id = p_project and pm.user_id = (select auth.uid()) and pm.role = 'homeowner'
  );
$$;

create or replace function public.ic_can_open(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ic_is_team(p_project) or public.ic_is_homeowner(p_project);
$$;

-- May the caller see this entry? Team sees all; a homeowner must be a current member AND in the audience.
create or replace function public.ic_can_see(p_project uuid, p_audience uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ic_is_team(p_project)
      or ((select auth.uid()) = any(p_audience) and public.ic_is_homeowner(p_project));
$$;

revoke all on function public.ic_is_team(uuid), public.ic_is_homeowner(uuid), public.ic_can_open(uuid), public.ic_can_see(uuid, uuid[]) from public, anon;
grant execute on function public.ic_is_team(uuid), public.ic_is_homeowner(uuid), public.ic_can_open(uuid), public.ic_can_see(uuid, uuid[]) to authenticated;

-- ───────────────────────────────── row-level security ─────────────────────────
alter table public.ic_businesses enable row level security;
alter table public.ic_business_members enable row level security;
alter table public.ic_projects enable row level security;
alter table public.ic_project_members enable row level security;
alter table public.ic_invitations enable row level security;
alter table public.ic_items enable row level security;
alter table public.ic_events enable row level security;
alter table public.ic_replies enable row level security;

revoke all on all tables in schema public from anon;
grant select on public.ic_businesses, public.ic_business_members, public.ic_projects, public.ic_project_members,
  public.ic_invitations, public.ic_items, public.ic_events, public.ic_replies to authenticated;

create policy ic_businesses_read on public.ic_businesses for select to authenticated
  using (exists (select 1 from public.ic_business_members m where m.business_id = id and m.user_id = (select auth.uid())));
create policy ic_business_members_read on public.ic_business_members for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.ic_business_members m where m.business_id = business_id and m.user_id = (select auth.uid())));

create policy ic_projects_read on public.ic_projects for select to authenticated using (public.ic_can_open(id));
create policy ic_project_members_read on public.ic_project_members for select to authenticated using (public.ic_can_open(project_id));
create policy ic_invitations_read on public.ic_invitations for select to authenticated using (public.ic_is_team(project_id));

-- The base items table is TEAM ONLY. Homeowners read items through ic_items_v below.
create policy ic_items_read on public.ic_items for select to authenticated using (public.ic_is_team(project_id));

create policy ic_events_read on public.ic_events for select to authenticated
  using (public.ic_can_see(project_id, audience));
create policy ic_replies_read on public.ic_replies for select to authenticated
  using (exists (select 1 from public.ic_events e where e.id = event_id and public.ic_can_see(e.project_id, e.audience)));

-- ───────────────────────────── items: the redacting view ───────────────────────
-- Runs as its owner (which owns the tables, so RLS does not apply inside it) and does its own
-- gate in WHERE. security_barrier stops a leaky function in a caller's WHERE from seeing rows
-- before this filter. Column rules mirror src/model/visibility.ts exactly:
--   price     team, or coalesce(share_price,    purchased_by = 'homeowner' or project.show_prices)
--   sourcing  team, or coalesce(share_sourcing, purchased_by = 'homeowner')
--   team      team only
create view public.ic_items_v with (security_barrier = true) as
  select
    i.id, i.project_id, i.name, i.room, i.quantity, i.unit, i.status, i.purchased_by,
    i.created_at, i.updated_at,
    case when t.is_team or coalesce(i.share_price, i.purchased_by = 'homeowner' or p.show_prices)
         then i.client_price_cents end as client_price_cents,
    case when t.is_team or coalesce(i.share_sourcing, i.purchased_by = 'homeowner') then i.supplier       end as supplier,
    case when t.is_team or coalesce(i.share_sourcing, i.purchased_by = 'homeowner') then i.sku            end as sku,
    case when t.is_team or coalesce(i.share_sourcing, i.purchased_by = 'homeowner') then i.order_number   end as order_number,
    case when t.is_team or coalesce(i.share_sourcing, i.purchased_by = 'homeowner') then i.lead_time_days end as lead_time_days,
    case when t.is_team then i.supplier_cost_cents end as supplier_cost_cents,
    case when t.is_team then i.note                end as note,
    case when t.is_team then i.share_price         end as share_price,
    case when t.is_team then i.share_sourcing      end as share_sourcing
  from public.ic_items i
  join public.ic_projects p on p.id = i.project_id
  cross join lateral (select public.ic_is_team(i.project_id) as is_team) t
  where public.ic_can_open(i.project_id);

revoke all on public.ic_items_v from public, anon;
grant select on public.ic_items_v to authenticated;

-- ─────────────────────────────────── writes ─────────────────────────────────────
-- All writes go through functions. Clients have no INSERT/UPDATE/DELETE grants.

-- A contractor creates their business. One per owner for now.
create or replace function public.ic_create_business(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise insufficient_privilege; end if;
  insert into public.ic_businesses(name, owner_user_id) values (trim(p_name), v_uid) returning id into v_id;
  insert into public.ic_business_members(business_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

-- Mode decides the defaults: all_in hides prices on the contractor's items; the others show them.
create or replace function public.ic_create_project(p_business uuid, p_name text, p_address text, p_homeowner_name text, p_mode text default 'hybrid')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.ic_business_members where business_id = p_business and user_id = (select auth.uid())) then raise insufficient_privilege; end if;
  insert into public.ic_projects(business_id, name, address, homeowner_name, mode, show_prices)
    values (p_business, trim(p_name), coalesce(p_address,''), p_homeowner_name, coalesce(p_mode,'hybrid'), coalesce(p_mode,'hybrid') <> 'all_in')
    returning id into v_id;
  -- The creator is listed as the project's contractor so both sides can see who runs it.
  -- (Access still comes from the business, not from this row — see ic_is_team.)
  insert into public.ic_project_members(project_id, user_id, role, display_name)
    select v_id, u.id, 'contractor', coalesce(u.raw_user_meta_data->>'display_name', u.email, 'Contractor')
      from auth.users u where u.id = (select auth.uid());
  return v_id;
end $$;

-- Change a project's sharing posture later. Existing per-item overrides are kept.
create or replace function public.ic_set_project_sharing(p_project uuid, p_mode text, p_show_prices boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  update public.ic_projects set mode = coalesce(p_mode, mode), show_prices = coalesce(p_show_prices, show_prices) where id = p_project;
end $$;

-- Start and target dates, set or changed after creation. Null leaves a date as it is.
create or replace function public.ic_set_project_dates(p_project uuid, p_start date, p_target date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  update public.ic_projects set start_date = coalesce(p_start, start_date), target_date = coalesce(p_target, target_date) where id = p_project;
end $$;

-- The contractor invites the homeowner. Returns the code to read out or text.
create or replace function public.ic_create_invitation(p_project uuid, p_email text, p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  insert into public.ic_invitations(project_id, email, code, created_by) values (p_project, lower(trim(p_email)), upper(p_code), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- The homeowner, signed in with the invited address, redeems the code and becomes a member.
create or replace function public.ic_accept_invitation(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv record; v_email text;
begin
  select lower(email) into v_email from auth.users where id = (select auth.uid());
  if v_email is null then raise insufficient_privilege; end if;
  select * into inv from public.ic_invitations
    where code = upper(trim(p_code)) and email = v_email and accepted_at is null and expires_at > now()
    for update;
  if inv is null then raise exception 'IC_INVITE_INVALID' using errcode = 'P0002'; end if;
  insert into public.ic_project_members(project_id, user_id, role, display_name)
    values (inv.project_id, auth.uid(), 'homeowner', coalesce(nullif(trim(p_display_name),''), v_email))
    on conflict (project_id, user_id) do update set display_name = excluded.display_name;
  update public.ic_invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.project_id;
end $$;

-- Sign-up gate. Configure as the Before User Created auth hook (same mechanism Itera uses).
-- A person may create an account if they are on the approved contractor list OR hold a live invitation.
create table if not exists public.ic_approved_contractors (
  email text primary key check (email = lower(trim(email))),
  enabled boolean not null default true
);
alter table public.ic_approved_contractors enable row level security;
revoke all on public.ic_approved_contractors from public, anon, authenticated;

create or replace function public.ic_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(event->'user'->>'email'));
begin
  if exists (select 1 from public.ic_approved_contractors a where a.email = v_email and a.enabled)
     or exists (select 1 from public.ic_invitations i where i.email = v_email and i.accepted_at is null and i.expires_at > now())
  then return '{}'::jsonb; end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Itera Connect is available to approved contractors and invited homeowners.'));
end $$;
revoke all on function public.ic_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.ic_before_user_created(jsonb) to supabase_auth_admin;

-- The kind-specific json must at least have the fields the app relies on.
create or replace function public.ic_check_event_data(p_kind text, d jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'IC_EVENT_DATA'; end if;
  case p_kind
    when 'note' then null;
    when 'milestone' then
      if d->>'title' is null or coalesce(d->>'status','') not in ('planned','started','done') then raise exception 'IC_EVENT_DATA'; end if;
    when 'schedule' then
      if d->>'title' is null or d->>'date' is null then raise exception 'IC_EVENT_DATA'; end if;
    when 'order' then
      if d->>'itemId' is null then raise exception 'IC_EVENT_DATA'; end if;
    when 'delivery' then
      if d->>'itemId' is null or jsonb_typeof(d->'expected') <> 'number' or jsonb_typeof(d->'received') <> 'number' or jsonb_typeof(d->'damaged') <> 'number'
      then raise exception 'IC_EVENT_DATA'; end if;
    when 'approval_requested' then
      if d->>'approvalId' is null or d->>'title' is null then raise exception 'IC_EVENT_DATA'; end if;
    when 'approval_decided' then
      if d->>'approvalId' is null or coalesce(d->>'decision','') not in ('approved','changes_requested') then raise exception 'IC_EVENT_DATA'; end if;
    when 'photo' then
      if d->>'uri' is null then raise exception 'IC_EVENT_DATA'; end if;
    when 'document_sent' then
      if d->>'title' is null or d->>'to' is null or coalesce(d->>'via','') not in ('email','print','other') or jsonb_typeof(d->'layers') <> 'array'
      then raise exception 'IC_EVENT_DATA'; end if;
    when 'dismissal' then
      if d->>'suggestionId' is null or d->>'title' is null
         or coalesce(d->>'severity','') not in ('info','attention','urgent')
         or coalesce(d->>'action','') not in ('dismiss','restore','acted')
      then raise exception 'IC_EVENT_DATA'; end if;
    else raise exception 'IC_EVENT_KIND';
  end case;
end $$;

-- Append one event. Enforces the role and audience rules the app also enforces:
--   • a decision goes to exactly the people who were asked, whoever posts it
--   • a homeowner may post note / photo / approval_decided only, addressed to every homeowner
--   • a contractor may address any current members of the project; empty = team only
create or replace function public.ic_append_event(p_project uuid, p_kind text, p_audience uuid[], p_body text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_name text; v_id uuid; v_uid uuid := auth.uid();
        v_audience uuid[] := coalesce(p_audience, '{}'); v_data jsonb := coalesce(p_data, '{}'::jsonb);
        v_req_audience uuid[]; v_req_item text;
begin
  if public.ic_is_team(p_project) then v_role := 'contractor';
  elsif public.ic_is_homeowner(p_project) then v_role := 'homeowner';
  else raise insufficient_privilege; end if;

  perform public.ic_check_event_data(p_kind, v_data);

  if p_kind = 'approval_decided' then
    select r.audience, r.data->>'itemId' into v_req_audience, v_req_item from public.ic_events r
      where r.project_id = p_project and r.kind = 'approval_requested' and r.data->>'approvalId' = v_data->>'approvalId'
      order by r.at desc limit 1;
    if not found then raise exception 'IC_APPROVAL_MISSING' using errcode = 'P0002'; end if;
    if v_role = 'homeowner' and not (v_uid = any(v_req_audience)) then raise insufficient_privilege; end if;
    -- "Already decided" applies to the current request only: a decision that predates the latest
    -- (re)request has been superseded by it.
    if exists (select 1 from public.ic_events e where e.project_id = p_project and e.kind = 'approval_decided'
               and e.data->>'approvalId' = v_data->>'approvalId'
               and e.at > (select max(r.at) from public.ic_events r where r.project_id = p_project
                            and r.kind = 'approval_requested' and r.data->>'approvalId' = v_data->>'approvalId'))
    then raise exception 'IC_ALREADY_DECIDED'; end if;
    v_audience := v_req_audience;
  elsif v_role = 'homeowner' then
    if p_kind not in ('note','photo') then raise exception 'IC_HOMEOWNER_KIND'; end if;
    select coalesce(array_agg(pm.user_id), '{}'::uuid[]) into v_audience
      from public.ic_project_members pm where pm.project_id = p_project and pm.role = 'homeowner';
  else
    if exists (select 1 from unnest(v_audience) a
               where not exists (select 1 from public.ic_project_members pm where pm.project_id = p_project and pm.user_id = a))
    then raise exception 'IC_AUDIENCE_NOT_MEMBER'; end if;
    -- A dismissal is the business's own bookkeeping; it never has an audience.
    if p_kind = 'dismissal' then v_audience := '{}'::uuid[]; end if;
  end if;

  select coalesce(pm.display_name, u.raw_user_meta_data->>'display_name', u.email) into v_name
    from auth.users u left join public.ic_project_members pm on pm.project_id = p_project and pm.user_id = u.id
    where u.id = v_uid;

  insert into public.ic_events(project_id, author_id, author_name, author_role, audience, kind, body, data)
    values (p_project, v_uid, v_name, v_role, v_audience, p_kind, p_body, v_data) returning id into v_id;

  -- The item under discussion follows the decision: approved, or back to the contractor.
  -- Only items still under discussion move; a late "request changes" does not un-order anything.
  if p_kind = 'approval_decided' and v_req_item is not null then
    update public.ic_items i
      set status = case when v_data->>'decision' = 'approved' then 'approved' else 'changes_requested' end,
          updated_at = now()
      where i.project_id = p_project and i.status in ('proposed','changes_requested') and i.id::text = v_req_item;
  end if;
  -- Asking again after "request changes": the item is under discussion once more.
  if p_kind = 'approval_requested' and v_data->>'itemId' is not null then
    update public.ic_items i set status = 'proposed', updated_at = now()
      where i.project_id = p_project and i.status = 'changes_requested' and i.id::text = v_data->>'itemId';
  end if;
  return v_id;
end $$;

create or replace function public.ic_reply(p_event uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e record; v_role text; v_name text; v_id uuid; v_uid uuid := auth.uid();
begin
  select * into e from public.ic_events where id = p_event;
  if e is null then raise exception 'IC_EVENT_MISSING' using errcode = 'P0002'; end if;
  if public.ic_is_team(e.project_id) then v_role := 'contractor';
  elsif public.ic_is_homeowner(e.project_id) and v_uid = any(e.audience) then v_role := 'homeowner';
  else raise insufficient_privilege; end if;
  select coalesce(pm.display_name, u.raw_user_meta_data->>'display_name', u.email) into v_name
    from auth.users u left join public.ic_project_members pm on pm.project_id = e.project_id and pm.user_id = u.id where u.id = v_uid;
  insert into public.ic_replies(event_id, author_id, author_name, author_role, body) values (p_event, v_uid, v_name, v_role, p_body) returning id into v_id;
  return v_id;
end $$;

-- Items are contractor-maintained. p_item is the app's Item shape:
--   { id?, name, room?, quantity?, unit?, status?, purchasedBy?, clientPrice?, sharePrice?, shareSourcing?,
--     sourcing?: { supplier?, sku?, orderNumber?, leadTimeDays? }, team?: { supplierCost?, note? } }
-- purchasedBy defaults from the project mode (labor_only → homeowner, otherwise contractor).
create or replace function public.ic_upsert_item(p_project uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_mode text; s jsonb := coalesce(p_item->'sourcing', '{}'::jsonb); t jsonb := coalesce(p_item->'team', '{}'::jsonb);
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  select mode into v_mode from public.ic_projects where id = p_project;
  insert into public.ic_items(id, project_id, name, room, quantity, unit, status, purchased_by, client_price_cents, share_price, share_sourcing,
                              supplier, sku, order_number, lead_time_days, supplier_cost_cents, note)
    values (coalesce((p_item->>'id')::uuid, gen_random_uuid()), p_project, p_item->>'name', p_item->>'room',
            coalesce((p_item->>'quantity')::numeric, 1), p_item->>'unit', coalesce(p_item->>'status', 'proposed'),
            coalesce(p_item->>'purchasedBy', case when v_mode = 'labor_only' then 'homeowner' else 'contractor' end),
            (p_item->>'clientPrice')::bigint, (p_item->>'sharePrice')::boolean, (p_item->>'shareSourcing')::boolean,
            s->>'supplier', s->>'sku', s->>'orderNumber', (s->>'leadTimeDays')::int, (t->>'supplierCost')::bigint, t->>'note')
    on conflict (id) do update set
      name = excluded.name, room = excluded.room, quantity = excluded.quantity, unit = excluded.unit, status = excluded.status,
      purchased_by = excluded.purchased_by, client_price_cents = excluded.client_price_cents,
      share_price = excluded.share_price, share_sourcing = excluded.share_sourcing,
      supplier = excluded.supplier, sku = excluded.sku, order_number = excluded.order_number, lead_time_days = excluded.lead_time_days,
      supplier_cost_cents = excluded.supplier_cost_cents, note = excluded.note, updated_at = now()
    returning id into v_id;
  return v_id;
end $$;

revoke all on function
  public.ic_create_business(text), public.ic_create_project(uuid,text,text,text,text), public.ic_set_project_sharing(uuid,text,boolean),
  public.ic_set_project_dates(uuid,date,date),
  public.ic_create_invitation(uuid,text,text), public.ic_accept_invitation(text,text), public.ic_check_event_data(text,jsonb),
  public.ic_append_event(uuid,text,uuid[],text,jsonb), public.ic_reply(uuid,text), public.ic_upsert_item(uuid,jsonb)
  from public, anon;
grant execute on function
  public.ic_create_business(text), public.ic_create_project(uuid,text,text,text,text), public.ic_set_project_sharing(uuid,text,boolean),
  public.ic_set_project_dates(uuid,date,date),
  public.ic_create_invitation(uuid,text,text), public.ic_accept_invitation(text,text),
  public.ic_append_event(uuid,text,uuid[],text,jsonb), public.ic_reply(uuid,text), public.ic_upsert_item(uuid,jsonb)
  to authenticated;

-- ─────────────────────────────────── realtime ──────────────────────────────────
-- Change notifications respect RLS: homeowners get event/reply changes they may see; item changes
-- reach the team only (homeowners re-read ic_items_v when an event arrives).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ic_events, public.ic_replies, public.ic_items;
  end if;
end $$;

commit;
