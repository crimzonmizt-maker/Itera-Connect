-- Rooms. The contractor names a room freely; `type` is what the app reasons with. A type set
-- by the contractor is confirmed; one guessed by the app from the name is not, and nothing is
-- ever decided on an unconfirmed guess. Items point at a room by id; the free-text
-- ic_items.room column goes away (existing text becomes a room row first, so nothing is lost).
--
-- Rooms have nothing to hide: every member of the project reads the same list.

create table public.ic_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ic_projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  type text check (type is null or type in ('bathroom','kitchen','bedroom','living','laundry','basement','garage','exterior','other')),
  type_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ic_rooms(project_id);
-- One "Primary bath" per project, however it is capitalised.
create unique index ic_rooms_project_name on public.ic_rooms(project_id, lower(trim(name)));

alter table public.ic_rooms enable row level security;
grant select on public.ic_rooms to authenticated;
create policy ic_rooms_read on public.ic_rooms for select to authenticated using (public.ic_can_open(project_id));

-- Items move from a text label to a room id.
alter table public.ic_items add column room_id uuid references public.ic_rooms(id) on delete set null;
create index on public.ic_items(room_id);

-- Carry existing labels across: one room per distinct label per project, unconfirmed type.
insert into public.ic_rooms(project_id, name)
  select distinct project_id, trim(room) from public.ic_items
  where room is not null and length(trim(room)) > 0
  on conflict do nothing;
update public.ic_items i set room_id = r.id
  from public.ic_rooms r
  where r.project_id = i.project_id and i.room is not null and lower(trim(i.room)) = lower(trim(r.name));

-- The redacting view: same columns as before, room_id in place of room. Recreated because a
-- view's column list cannot be edited in place.
drop view public.ic_items_v;
alter table public.ic_items drop column room;
create view public.ic_items_v with (security_barrier = true) as
  select
    i.id, i.project_id, i.name, i.room_id, i.quantity, i.unit, i.status, i.purchased_by,
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

-- p_room is the app's RoomInput: { id?, name, type? }. A type given here is the contractor's
-- word (confirmed). Without one, a confirmed type is kept; otherwise the app's guess, which
-- the client passes as `guess`, is stored unconfirmed. The database does not guess itself, so
-- the one list of name hints lives in src/model/rooms.ts.
create or replace function public.ic_upsert_room(p_project uuid, p_room jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := trim(p_room->>'name'); v_type text := p_room->>'type'; v_guess text := p_room->>'guess';
        v_existing public.ic_rooms%rowtype;
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  if v_name is null or v_name = '' then raise exception 'IC_ROOM_NAME_REQUIRED'; end if;
  if p_room->>'id' is not null then
    select * into v_existing from public.ic_rooms where id = (p_room->>'id')::uuid and project_id = p_project;
    if not found then raise exception 'IC_ROOM_NOT_FOUND'; end if;
  end if;
  insert into public.ic_rooms(id, project_id, name, type, type_confirmed)
    values (coalesce(v_existing.id, gen_random_uuid()), p_project, v_name,
            coalesce(v_type, case when v_existing.type_confirmed then v_existing.type else v_guess end),
            v_type is not null or coalesce(v_existing.type_confirmed, false))
    on conflict (id) do update set
      name = excluded.name, type = excluded.type, type_confirmed = excluded.type_confirmed, updated_at = now()
    returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'IC_ROOM_NAME_TAKEN';
end $$;

-- ic_upsert_item: roomId replaces room, and must be a room on the same project.
create or replace function public.ic_upsert_item(p_project uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_mode text; v_room uuid := (p_item->>'roomId')::uuid;
        s jsonb := coalesce(p_item->'sourcing', '{}'::jsonb); t jsonb := coalesce(p_item->'team', '{}'::jsonb);
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  if v_room is not null and not exists (select 1 from public.ic_rooms r where r.id = v_room and r.project_id = p_project) then
    raise exception 'IC_ROOM_NOT_ON_PROJECT';
  end if;
  select mode into v_mode from public.ic_projects where id = p_project;
  insert into public.ic_items(id, project_id, name, room_id, quantity, unit, status, purchased_by, client_price_cents, share_price, share_sourcing,
                              supplier, sku, order_number, lead_time_days, supplier_cost_cents, note)
    values (coalesce((p_item->>'id')::uuid, gen_random_uuid()), p_project, p_item->>'name', v_room,
            coalesce((p_item->>'quantity')::numeric, 1), p_item->>'unit', coalesce(p_item->>'status', 'proposed'),
            coalesce(p_item->>'purchasedBy', case when v_mode = 'labor_only' then 'homeowner' else 'contractor' end),
            (p_item->>'clientPrice')::bigint, (p_item->>'sharePrice')::boolean, (p_item->>'shareSourcing')::boolean,
            s->>'supplier', s->>'sku', s->>'orderNumber', (s->>'leadTimeDays')::int, (t->>'supplierCost')::bigint, t->>'note')
    on conflict (id) do update set
      name = excluded.name, room_id = excluded.room_id, quantity = excluded.quantity, unit = excluded.unit, status = excluded.status,
      purchased_by = excluded.purchased_by, client_price_cents = excluded.client_price_cents,
      share_price = excluded.share_price, share_sourcing = excluded.share_sourcing,
      supplier = excluded.supplier, sku = excluded.sku, order_number = excluded.order_number, lead_time_days = excluded.lead_time_days,
      supplier_cost_cents = excluded.supplier_cost_cents, note = excluded.note, updated_at = now()
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.ic_upsert_room(uuid,jsonb) from public, anon;
grant execute on function public.ic_upsert_room(uuid,jsonb) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ic_rooms;
  end if;
end $$;
