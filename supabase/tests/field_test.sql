-- Proves the field-test rules (migration 20260925_field_test.sql) against a real Postgres:
--   1. a contractor can read their own business (the old read rule looped forever)
--   2. every account is Pro by default; a Free account is held to its project limit
--   3. nobody can overwrite another business's item, and nobody can write tables directly
--   4. each contractor sees only their own projects; a homeowner only the one they joined
--   5. files: team reads its project's files; a homeowner only files on entries addressed to them
-- Values that DO blocks need are carried in `test.*` settings, since psql variables do not reach inside $$.
begin;

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000e1', 'ella@test.local', now(), '{"display_name":"Ella"}'),
       ('00000000-0000-0000-0000-0000000000f1', 'finn@test.local', now(), '{"display_name":"Finn"}'),
       ('00000000-0000-0000-0000-0000000000a1', 'hana@test.local', now(), '{"display_name":"Hana"}')
on conflict (id) do nothing;

-- ── Sign-up is open during the field test ────────────────────────────────────────────────────
do $$ begin
  assert public.ic_before_user_created('{"user":{"email":"stranger@test.local"}}') = '{}'::jsonb, 'open sign-up admits a new e-mail';
end $$;

-- ── Ella: a brand-new contractor, no approval list ──────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  assert public.ic_my_account()->>'plan' = 'pro', 'Pro by default';
  assert public.ic_my_account()->'projectLimit' = 'null'::jsonb, 'Pro has no project limit';
end $$;

select public.ic_create_business('Ella Renovations') as ella_biz \gset
select set_config('test.ella_biz', :'ella_biz', true);
do $$ begin
  assert public.ic_create_business('Ella again') = current_setting('test.ella_biz')::uuid, 'a second tap returns the same business';
  -- The fix: this read used to fail with "infinite recursion detected in policy".
  assert (select count(*) from public.ic_business_members) = 1, 'Ella reads her own membership';
  assert (select name from public.ic_businesses) = 'Ella Renovations', 'Ella reads her own business';
end $$;

select public.ic_create_project(:'ella_biz', 'Hana kitchen', '1 Oak St', 'Hana', 'hybrid') as ella_p1 \gset
select public.ic_create_project(:'ella_biz', 'Second job', '2 Oak St', null, 'all_in') as ella_p2 \gset
select public.ic_upsert_item(:'ella_p1', '{"name":"Faucet","clientPrice":40000,"team":{"supplierCost":25000},"sourcing":{"sku":"K-596"}}') as ella_item \gset
select public.ic_create_invitation(:'ella_p1', 'hana@test.local', 'HJKLMNPQ');
select set_config('test.ella_p1', :'ella_p1', true), set_config('test.ella_item', :'ella_item', true);

-- A team-only photo and a shared PDF, uploaded into Ella's project folder.
select set_config('test.team_file', :'ella_p1' || '/aaaa/private.jpg', true),
       set_config('test.shared_file', :'ella_p1' || '/bbbb/spec sheet.pdf', true);
insert into storage.objects(bucket_id, name, owner)
  values ('ic-files', current_setting('test.team_file'), auth.uid()),
         ('ic-files', current_setting('test.shared_file'), auth.uid());

do $$ begin
  -- Nobody writes tables directly, not even the team.
  begin
    insert into public.ic_items(project_id, name) values (current_setting('test.ella_p1')::uuid, 'sneaky');
    raise exception 'direct insert should be refused';
  exception when insufficient_privilege then null; end;
end $$;

-- ── Finn: a second contractor ───────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select public.ic_create_business('Finn Builds') as finn_biz \gset
select public.ic_create_project(:'finn_biz', 'Finn bath', '9 Elm St', null, 'hybrid') as finn_p \gset
select set_config('test.finn_p', :'finn_p', true);

do $$ begin
  assert (select count(*) from public.ic_projects) = 1, 'Finn sees only his own project';
  assert (select count(*) from public.ic_businesses) = 1, 'Finn sees only his own business';
  assert (select count(*) from public.ic_business_members) = 1, 'Finn sees only his own membership';
  assert (select count(*) from public.ic_items_v) = 0, 'Finn sees none of Ella''s items';
  assert (select count(*) from storage.objects) = 0, 'Finn reads none of Ella''s files';

  -- The fix: using Ella's item id from Finn's own project is refused, not an overwrite.
  begin
    perform public.ic_upsert_item(current_setting('test.finn_p')::uuid,
      jsonb_build_object('id', current_setting('test.ella_item'), 'name', 'HACKED', 'clientPrice', 1));
    raise exception 'cross-project upsert should be refused';
  exception when others then
    if sqlerrm not like '%IC_ITEM_NOT_ON_PROJECT%' then raise; end if;
  end;

  -- And Finn cannot write into Ella's project directly or into her file folder.
  begin
    perform public.ic_upsert_item(current_setting('test.ella_p1')::uuid, '{"name":"x"}');
    raise exception 'upsert into another business''s project should be refused';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id, name) values ('ic-files', current_setting('test.ella_p1') || '/cccc/x.jpg');
    raise exception 'upload into another project should be refused';
  exception when insufficient_privilege then null; end;
end $$;

-- ── Hana: joins Ella's kitchen by invitation ───────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.ic_accept_invitation('HJKLMNPQ', 'Hana');

do $$ begin
  assert (select count(*) from public.ic_projects) = 1, 'Hana sees the one project she joined';
  assert (select name from public.ic_projects) = 'Hana kitchen', 'and it is the right one';
  assert (select count(*) from public.ic_business_members) = 0, 'Hana is on no business team';
  assert (select supplier_cost_cents from public.ic_items_v) is null, 'supplier cost never reaches Hana';
  assert (select count(*) from storage.objects) = 0, 'no file is readable before an entry points at it';
end $$;

-- ── Ella posts: the photo stays team-only, the PDF is addressed to Hana ─────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'ella_p1', 'photo', '{}', null,
  jsonb_build_object('uri', current_setting('test.team_file'), 'caption', 'Behind the wall'));
select public.ic_append_event(:'ella_p1', 'note', array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'Spec sheet for the faucet',
  jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('path', current_setting('test.shared_file'), 'name', 'spec sheet.pdf', 'mimeType', 'application/pdf'))));
do $$ begin
  assert (select count(*) from storage.objects) = 2, 'Ella reads both of her project''s files';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects) = 1, 'Hana reads exactly one file';
  assert (select name from storage.objects) = current_setting('test.shared_file'), 'the one addressed to her';
end $$;
-- Hana can share a photo into her own project's folder.
insert into storage.objects(bucket_id, name) values ('ic-files', :'ella_p1' || '/dddd/leak.jpg');

-- ── A Free account is held to its limit ─────────────────────────────────────────────────────
reset role;
select public.ic_set_plan('finn@test.local', 'free');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.finn_biz', :'finn_biz', true);
do $$ begin
  assert public.ic_my_account()->>'plan' = 'free', 'Finn is now Free';
  assert (public.ic_my_account()->>'projectLimit')::int = 1, 'Free allows one project';
  begin
    perform public.ic_create_project(current_setting('test.finn_biz')::uuid, 'One too many', '', null, 'hybrid');
    raise exception 'a Free account over its limit should be refused';
  exception when others then
    if sqlerrm not like '%IC_PLAN_LIMIT%' then raise; end if;
  end;
  -- App users cannot change plans.
  begin
    perform public.ic_set_plan('finn@test.local', 'pro');
    raise exception 'ic_set_plan should be admin-only';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
select 'ALL FIELD TEST CHECKS PASSED' as result;
