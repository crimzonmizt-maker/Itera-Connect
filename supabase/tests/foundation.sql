-- Run in a scratch database after the migration (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/foundation.sql
-- Checks the rules that matter most:
--   1. a homeowner sees only entries addressed to THEM (not to the other homeowner, not team-only)
--   2. a homeowner sees supplier/SKU only for items THEY buy, and supplier cost / team notes never
--   3. a homeowner can reply and decide, but cannot post milestones or choose an audience
--   4. a decision goes to exactly the people who were asked
begin;

-- Three fake users: contractor Mike, homeowners Dana and Sam.
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000c001', 'mike@test.local', now(), '{"display_name":"Mike"}'),
       ('00000000-0000-0000-0000-00000000d001', 'dana@test.local', now(), '{"display_name":"Dana"}'),
       ('00000000-0000-0000-0000-00000000a001', 'sam@test.local',  now(), '{"display_name":"Sam"}')
on conflict (id) do nothing;

-- ── Act as the contractor ──────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;

select public.ic_create_business('Test Builders') as business_id \gset
select public.ic_create_project(:'business_id', 'Test bath', '1 Test St', 'Dana', 'hybrid') as project_id \gset
select public.ic_set_project_dates(:'project_id', null, '2026-10-24');
select public.ic_create_invitation(:'project_id', 'dana@test.local', 'ABCDEFGH');
select public.ic_create_invitation(:'project_id', 'sam@test.local',  'BCDEFGHJ');

-- Contractor supplies the vanity; Dana buys the tile herself.
select public.ic_upsert_item(:'project_id',
  '{"name":"Vanity","quantity":1,"clientPrice":184000,"status":"proposed","purchasedBy":"contractor",
    "sourcing":{"supplier":"Northline","sku":"CB-48-WO","leadTimeDays":42},
    "team":{"supplierCost":126500,"note":"margin note"}}') as vanity_id \gset
select public.ic_upsert_item(:'project_id',
  '{"name":"Floor tile","quantity":14,"unit":"box","clientPrice":98000,"status":"proposed","purchasedBy":"homeowner",
    "sourcing":{"supplier":"Emser","sku":"HAN-1224-GR"},
    "team":{"note":"Dana orders this herself"}}') as tile_id \gset

-- Team-only note (empty audience), a milestone for everyone (set after they join), and a Dana-only approval.
select public.ic_append_event(:'project_id', 'note', '{}', 'Secret margin note', '{}');

do $$ begin
  assert (select count(*) from public.ic_events) = 1, 'contractor sees the team note';
  assert (select supplier_cost_cents from public.ic_items_v where name = 'Vanity') = 126500, 'contractor sees supplier cost through the view';
  assert (select count(*) from public.ic_items) = 2, 'contractor may read the base table';
  assert (select target_date from public.ic_projects limit 1) = date '2026-10-24', 'target date set';
end $$;

-- Contractor may not address someone who is not on the project.
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'note', array['00000000-0000-0000-0000-00000000d001']::uuid[], 'x', '{}');
    raise exception 'audience of a non-member should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_AUDIENCE_NOT_MEMBER%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- ── Dana and Sam accept ────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_accept_invitation('ABCDEFGH', 'Dana');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_accept_invitation('BCDEFGHJ', 'Sam');

-- ── Contractor posts to both, and to Dana alone ────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'milestone',
  array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000a001']::uuid[],
  null, '{"title":"Demolition","status":"done"}') as milestone_id \gset
select public.ic_append_event(:'project_id', 'approval_requested',
  array['00000000-0000-0000-0000-00000000d001']::uuid[],
  'Warm Gray or Bright White?', format('{"approvalId":"appr-1","title":"Grout colour","itemId":"%s"}', :'tile_id')::jsonb) as approval_id \gset
select public.ic_append_event(:'project_id', 'document_sent',
  array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000a001']::uuid[],
  null, '{"title":"Floor plan","via":"email","to":"dana@test.local","layers":["layout"]}');

-- Malformed kind data is rejected.
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'document_sent', '{}', null, '{"title":"no via"}');
    raise exception 'document_sent without via should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_EVENT_DATA%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- ── Act as Dana ────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  assert (select count(*) from public.ic_projects) = 1, 'Dana can open the project';
  assert (select count(*) from public.ic_events) = 3, 'Dana sees milestone + approval + document, not the team note';
  assert (select count(*) from public.ic_events where kind = 'note') = 0, 'no team note leaks';
  assert (select count(*) from public.ic_events where kind = 'dismissal') = 0, 'dismissals never reach a homeowner';
  assert (select count(*) from public.ic_items) = 0, 'Dana cannot read the base items table';
  assert (select count(*) from public.ic_items_v) = 2, 'Dana sees both items through the view';
  assert (select sku from public.ic_items_v where name = 'Floor tile') = 'HAN-1224-GR', 'Dana buys the tile, so she gets the SKU';
  assert (select sku from public.ic_items_v where name = 'Vanity') is null, 'contractor-supplied: no SKU';
  assert (select client_price_cents from public.ic_items_v where name = 'Vanity') = 184000, 'hybrid: price is shown';
  assert (select count(*) from public.ic_items_v where supplier_cost_cents is not null or note is not null) = 0, 'supplier cost and team notes never leave';
  assert (select count(*) from public.ic_invitations) = 0, 'Dana cannot list invitations';
end $$;

-- Dana may post a note (audience forced to every homeowner), reply, and decide; not a milestone.
select public.ic_append_event(:'project_id', 'note', '{}', 'Looks great!', '{}') as dana_note_id \gset
select public.ic_reply(:'milestone_id', 'Nice!');
select public.ic_append_event(:'project_id', 'approval_decided', '{}', null, '{"approvalId":"appr-1","decision":"approved"}') as decision_id \gset
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'milestone', '{}', null, '{"title":"x","status":"done"}');
    raise exception 'milestone by homeowner should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_HOMEOWNER_KIND%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
  begin
    perform public.ic_append_event(v_project, 'approval_decided', '{}', null, '{"approvalId":"appr-1","decision":"approved"}');
    raise exception 'second decision should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_ALREADY_DECIDED%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- A homeowner cannot post a dismissal.
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'dismissal', '{}', null, '{"suggestionId":"x","title":"x","severity":"info","action":"dismiss"}');
    raise exception 'dismissal by homeowner should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_HOMEOWNER_KIND%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- A dismissal is business-only whatever audience is passed.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'dismissal',
  array['00000000-0000-0000-0000-00000000d001']::uuid[], null,
  '{"suggestionId":"approval:appr-1","title":"Waiting on homeowner approval: Grout colour","severity":"urgent","action":"dismiss"}');
do $$ begin
  assert (select audience from public.ic_events where kind = 'dismissal') = '{}'::uuid[], 'dismissal audience forced empty';
end $$;
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'dismissal', '{}', null, '{"suggestionId":"x","title":"x","severity":"loud","action":"dismiss"}');
    raise exception 'bad severity should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_EVENT_DATA%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- Request-changes round trip on the vanity: Dana asks for changes, Mike asks again, Dana approves.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'approval_requested',
  array['00000000-0000-0000-0000-00000000d001']::uuid[],
  null, format('{"approvalId":"appr-2","title":"Vanity finish","itemId":"%s"}', :'vanity_id')::jsonb);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'approval_decided', '{}', 'Darker please', '{"approvalId":"appr-2","decision":"changes_requested"}');
do $$ begin
  assert (select status from public.ic_items_v where name = 'Vanity') = 'changes_requested', 'item follows the change request';
end $$;
do $$
declare v_project uuid := (select id from public.ic_projects limit 1);
begin
  begin
    perform public.ic_append_event(v_project, 'approval_decided', '{}', null, '{"approvalId":"appr-2","decision":"approved"}');
    raise exception 'second decision on the same request should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_ALREADY_DECIDED%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'approval_requested',
  array['00000000-0000-0000-0000-00000000d001']::uuid[],
  'Now in walnut', format('{"approvalId":"appr-2","title":"Vanity finish (revised)","itemId":"%s"}', :'vanity_id')::jsonb);
do $$ begin
  assert (select status from public.ic_items_v where name = 'Vanity') = 'proposed', 're-request puts the item back under discussion';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_append_event(:'project_id', 'approval_decided', '{}', null, '{"approvalId":"appr-2","decision":"approved"}');
do $$ begin
  assert (select status from public.ic_items_v where name = 'Vanity') = 'approved', 'second round approved';
end $$;

-- ── Act as Sam ─────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  assert (select count(*) from public.ic_events where kind = 'approval_requested') = 0, 'Sam was not asked about grout or the vanity';
  assert (select count(*) from public.ic_events where kind = 'approval_decided') = 0, 'Sam does not see the decisions either';
  assert (select count(*) from public.ic_events where kind = 'note') = 1, 'Sam sees Dana''s note (homeowner posts go to every homeowner)';
  assert (select count(*) from public.ic_events where kind = 'document_sent') = 1, 'Sam sees the document record';
  assert (select count(*) from public.ic_replies) = 1, 'Sam sees the reply on the shared milestone';
end $$;

-- Sam cannot reply to the Dana-only approval.
do $$
declare v_event uuid;
begin
  reset role;
  select id into v_event from public.ic_events where kind = 'approval_requested';
  set local role authenticated;
  begin
    perform public.ic_reply(v_event, 'me too');
    raise exception 'reply to an entry not addressed to Sam should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlstate <> '42501' then raise exception 'wrong error: % (%)', sqlerrm, sqlstate; end if; -- insufficient_privilege
  end;
end $$;

-- ── Back to the contractor: the record is complete and the decision kept its audience ─────
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.ic_events) = 11, 'contractor sees every entry';
  assert (select bool_and(audience = array['00000000-0000-0000-0000-00000000d001']::uuid[]) from public.ic_events where kind = 'approval_decided'),
       'decision audience copied from the request';
  assert (select array_length(audience, 1) from public.ic_events where kind = 'note' and author_role = 'homeowner') = 2,
       'a homeowner note is addressed to both homeowners';
  assert (select status from public.ic_items where name = 'Floor tile') = 'approved', 'approval moved the item forward';
end $$;

-- All-in mode hides prices on contractor-supplied items for the homeowner, unless shared per item.
select public.ic_set_project_sharing(:'project_id', 'all_in', false);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select client_price_cents from public.ic_items_v where name = 'Vanity') is null, 'all-in: vanity price hidden';
  assert (select client_price_cents from public.ic_items_v where name = 'Floor tile') = 98000, 'Dana buys the tile: price still shown';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
select public.ic_upsert_item(:'project_id', format('{"id":"%s","name":"Vanity","quantity":1,"clientPrice":184000,"status":"proposed","purchasedBy":"contractor","sharePrice":true,"sourcing":{"supplier":"Northline","sku":"CB-48-WO","leadTimeDays":42},"team":{"supplierCost":126500,"note":"margin note"}}', :'vanity_id')::jsonb);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select client_price_cents from public.ic_items_v where name = 'Vanity') = 184000, 'per-item share_price overrides all-in';
  assert (select sku from public.ic_items_v where name = 'Vanity') is null, 'sourcing still hidden';
end $$;

reset role;
select 'ALL FOUNDATION CHECKS PASSED' as result;
rollback;
