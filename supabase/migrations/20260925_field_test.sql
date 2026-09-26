-- Field test. Fixes from the 25 Sep audit, account plans, open contractor sign-up, and files.
--
--   1. Business membership is checked through a function. The old read rule on
--      ic_business_members looked itself up, which Postgres refuses ("infinite recursion"), so a
--      signed-in contractor could not read their own business and was shown the homeowner screen.
--   2. ic_upsert_item only updates an item that is already on the project it was called for.
--      Before, anyone with a business of their own could overwrite another business's item by id.
--   3. Clients hold no insert/update/delete grants on any ic_ table; writes go through functions.
--   4. Plans: every account is 'free' or 'pro'. An account with no row of its own follows
--      ic_config.default_plan, so during the field test everyone is Pro without anyone lifting a
--      finger. Change one account in the SQL editor:  select public.ic_set_plan('a@b.com', 'free');
--   5. Sign-up: while ic_config.open_signup is true, anyone may create an account and start a
--      business (only matters when the Before User Created hook is switched on).
--   6. Files: photos and PDFs go in the private 'ic-files' bucket under <project id>/... A file
--      can be read by the project's business team, or by a homeowner who can see an entry that
--      points at it — the same audience rule as the entry itself.

begin;

-- ───────────────────────────── 1. membership without recursion ─────────────────────────────
-- Runs as its owner, so reading ic_business_members inside it does not re-enter the read rule.
create or replace function public.ic_is_business_member(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ic_business_members m
                 where m.business_id = p_business and m.user_id = (select auth.uid()));
$$;
revoke all on function public.ic_is_business_member(uuid) from public, anon;
grant execute on function public.ic_is_business_member(uuid) to authenticated;

drop policy if exists ic_businesses_read on public.ic_businesses;
create policy ic_businesses_read on public.ic_businesses for select to authenticated
  using (public.ic_is_business_member(id));
drop policy if exists ic_business_members_read on public.ic_business_members;
create policy ic_business_members_read on public.ic_business_members for select to authenticated
  using (user_id = (select auth.uid()) or public.ic_is_business_member(business_id));

-- ───────────────────────────── 2. items stay on their project ──────────────────────────────
create or replace function public.ic_upsert_item(p_project uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_mode text; v_room uuid := (p_item->>'roomId')::uuid; v_given uuid := (p_item->>'id')::uuid;
        s jsonb := coalesce(p_item->'sourcing', '{}'::jsonb); t jsonb := coalesce(p_item->'team', '{}'::jsonb);
begin
  if not public.ic_is_team(p_project) then raise insufficient_privilege; end if;
  -- An id that belongs to another project is refused outright, never updated.
  if v_given is not null and exists (select 1 from public.ic_items i where i.id = v_given and i.project_id <> p_project) then
    raise exception 'IC_ITEM_NOT_ON_PROJECT';
  end if;
  if v_room is not null and not exists (select 1 from public.ic_rooms r where r.id = v_room and r.project_id = p_project) then
    raise exception 'IC_ROOM_NOT_ON_PROJECT';
  end if;
  select mode into v_mode from public.ic_projects where id = p_project;
  insert into public.ic_items(id, project_id, name, room_id, quantity, unit, status, purchased_by, client_price_cents, share_price, share_sourcing,
                              supplier, sku, order_number, lead_time_days, supplier_cost_cents, note)
    values (coalesce(v_given, gen_random_uuid()), p_project, p_item->>'name', v_room,
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
      -- Second lock on the same door: the update only lands on this project's row.
      where public.ic_items.project_id = p_project
    returning id into v_id;
  if v_id is null then raise exception 'IC_ITEM_NOT_ON_PROJECT'; end if;
  return v_id;
end $$;

-- ───────────────────────────── 3. no direct writes from clients ─────────────────────────────
revoke insert, update, delete, truncate on
  public.ic_businesses, public.ic_business_members, public.ic_projects, public.ic_project_members,
  public.ic_invitations, public.ic_items, public.ic_events, public.ic_replies, public.ic_rooms
  from authenticated, anon;

-- ───────────────────────────── 4. plans ─────────────────────────────────────────────────────
-- One row of settings. Edit it in the SQL editor; clients cannot read or change it.
create table public.ic_config (
  id boolean primary key default true check (id),
  open_signup boolean not null default true,
  default_plan text not null default 'pro' check (default_plan in ('free','pro')),
  free_project_limit int not null default 1 check (free_project_limit >= 0)
);
insert into public.ic_config default values;
alter table public.ic_config enable row level security;
revoke all on public.ic_config from public, anon, authenticated;

-- Only accounts that differ from the default need a row.
create table public.ic_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free','pro')),
  updated_at timestamptz not null default now()
);
alter table public.ic_accounts enable row level security;
revoke all on public.ic_accounts from public, anon, authenticated;

-- The caller's plan, and how many projects it allows (null = no limit).
create or replace function public.ic_my_account()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', coalesce(a.plan, c.default_plan),
    'projectLimit', case when coalesce(a.plan, c.default_plan) = 'free' then c.free_project_limit end)
  from public.ic_config c
  left join public.ic_accounts a on a.user_id = (select auth.uid());
$$;
revoke all on function public.ic_my_account() from public, anon;
grant execute on function public.ic_my_account() to authenticated;

-- Admin only (SQL editor / service role). Not granted to any app user.
create or replace function public.ic_set_plan(p_email text, p_plan text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'IC_NO_SUCH_ACCOUNT: %', p_email; end if;
  insert into public.ic_accounts(user_id, plan) values (v_uid, p_plan)
    on conflict (user_id) do update set plan = excluded.plan, updated_at = now();
end $$;
revoke all on function public.ic_set_plan(text, text) from public, anon, authenticated;

-- A business per owner: asking twice returns the one that exists (a double tap makes one business).
create or replace function public.ic_create_business(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise insufficient_privilege; end if;
  select id into v_id from public.ic_businesses where owner_user_id = v_uid order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.ic_businesses(name, owner_user_id) values (trim(p_name), v_uid) returning id into v_id;
  insert into public.ic_business_members(business_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

-- Creating a project respects the plan's project limit.
create or replace function public.ic_create_project(p_business uuid, p_name text, p_address text, p_homeowner_name text, p_mode text default 'hybrid')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_limit int;
begin
  if not public.ic_is_business_member(p_business) then raise insufficient_privilege; end if;
  v_limit := (public.ic_my_account()->>'projectLimit')::int;
  if v_limit is not null and (select count(*) from public.ic_projects where business_id = p_business) >= v_limit then
    raise exception 'IC_PLAN_LIMIT';
  end if;
  insert into public.ic_projects(business_id, name, address, homeowner_name, mode, show_prices)
    values (p_business, trim(p_name), coalesce(p_address,''), p_homeowner_name, coalesce(p_mode,'hybrid'), coalesce(p_mode,'hybrid') <> 'all_in')
    returning id into v_id;
  insert into public.ic_project_members(project_id, user_id, role, display_name)
    select v_id, u.id, 'contractor', coalesce(u.raw_user_meta_data->>'display_name', u.email, 'Contractor')
      from auth.users u where u.id = (select auth.uid());
  return v_id;
end $$;

-- ───────────────────────────── 5. sign-up gate ──────────────────────────────────────────────
create or replace function public.ic_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(event->'user'->>'email'));
begin
  if (select open_signup from public.ic_config)
     or exists (select 1 from public.ic_approved_contractors a where a.email = v_email and a.enabled)
     or exists (select 1 from public.ic_invitations i where i.email = v_email and i.accepted_at is null and i.expires_at > now())
  then return '{}'::jsonb; end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Itera Connect is available to approved contractors and invited homeowners.'));
end $$;
revoke all on function public.ic_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.ic_before_user_created(jsonb) to supabase_auth_admin;

-- ───────────────────────────── 6. files ─────────────────────────────────────────────────────
-- The project a stored file belongs to: the first folder of its path. Anything else is null.
create or replace function public.ic_file_project(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

-- The team reads every file on its projects. A homeowner reads a file only through an entry they
-- can see that points at it (a photo's uri, or one of a note's attachments).
create or replace function public.ic_can_read_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ic_is_team(public.ic_file_project(p_name))
      or exists (
        select 1 from public.ic_events e
        where e.project_id = public.ic_file_project(p_name)
          and (e.data->>'uri' = p_name
               or coalesce(e.data->'attachments', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path', p_name)))
          and public.ic_can_see(e.project_id, e.audience));
$$;
revoke all on function public.ic_file_project(text), public.ic_can_read_file(text) from public, anon;
grant execute on function public.ic_file_project(text), public.ic_can_read_file(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ic-files', 'ic-files', false, 26214400,
          array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'])
  on conflict (id) do nothing;

-- Any member may upload into their own project's folder; nobody may change or delete a file
-- once it is on the record (no update or delete policy).
drop policy if exists ic_files_insert on storage.objects;
create policy ic_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ic-files' and public.ic_can_open(public.ic_file_project(name)));
drop policy if exists ic_files_read on storage.objects;
create policy ic_files_read on storage.objects for select to authenticated
  using (bucket_id = 'ic-files' and public.ic_can_read_file(name));

commit;
