-- Proves the room rules against a real Postgres. Run after foundation.sql's migration set.
begin;

-- Two fake users of our own: contractor Rosa, homeowner Dana.
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000c002', 'rosa@test.local',  now(), '{"display_name":"Rosa"}'),
       ('00000000-0000-0000-0000-00000000d002', 'dana2@test.local', now(), '{"display_name":"Dana"}')
on conflict (id) do nothing;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}', true);
set local role authenticated;
select public.ic_create_business('Room Builders') as business_id \gset
select public.ic_create_project(:'business_id', 'Room test', '2 Test St', 'Dana', 'hybrid') as project_id \gset
select public.ic_create_invitation(:'project_id', 'dana2@test.local', 'CDEFGHJK');

-- A guessed type is stored unconfirmed; a typed one is confirmed.
select public.ic_upsert_room(:'project_id', '{"name":"Hall bath","guess":"bathroom"}') as hall_id \gset
select public.ic_upsert_room(:'project_id', '{"name":"The back room","type":"bedroom"}') as back_id \gset
do $$ begin
  assert (select type from public.ic_rooms where name = 'Hall bath') = 'bathroom', 'guess stored';
  assert (select type_confirmed from public.ic_rooms where name = 'Hall bath') = false, 'guess is unconfirmed';
  assert (select type_confirmed from public.ic_rooms where name = 'The back room') = true, 'typed is confirmed';
end $$;

-- Renaming keeps a confirmed type even when the client sends a different guess.
select public.ic_upsert_room(:'project_id', format('{"id":"%s","name":"Nursery","guess":"living"}', :'back_id')::jsonb);
do $$ begin
  assert (select type from public.ic_rooms where name = 'Nursery') = 'bedroom', 'confirmed type survives rename';
end $$;

-- Names are unique per project, case-insensitively.
do $$
declare v_project uuid := (select id from public.ic_projects where name = 'Room test');
begin
  begin
    perform public.ic_upsert_room(v_project, '{"name":"hall BATH"}');
    raise exception 'duplicate room should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_ROOM_NAME_TAKEN%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- An item may only point at a room on its own project.
select public.ic_upsert_item(:'project_id', format('{"name":"Mirror","roomId":"%s"}', :'hall_id')::jsonb) as mirror_id \gset
do $$
declare v_project uuid := (select id from public.ic_projects where name = 'Room test');
begin
  begin
    perform public.ic_upsert_item(v_project, '{"name":"Stray","roomId":"00000000-0000-0000-0000-0000000000ff"}');
    raise exception 'foreign room should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlerrm not like '%IC_ROOM_NOT_ON_PROJECT%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
end $$;

-- The homeowner sees the room list and the item's room, nothing else new.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}', true);
set local role authenticated;
select public.ic_accept_invitation('CDEFGHJK', 'Dana');
do $$
declare v_project uuid := (select id from public.ic_projects where name = 'Room test');
begin
  assert (select count(*) from public.ic_rooms) = 2, 'homeowner sees both rooms';
  assert (select room_id from public.ic_items_v where name = 'Mirror') is not null, 'item carries its room';
  begin
    perform public.ic_upsert_room(v_project, '{"name":"Kitchen"}');
    raise exception 'homeowner room edit should have failed';
  exception when others then
    if sqlerrm like '%should have failed%' then raise; end if;
    if sqlstate <> '42501' then raise exception 'wrong error: % (%)', sqlerrm, sqlstate; end if;
  end;
end $$;

reset role;
select 'ALL ROOM CHECKS PASSED' as result;
rollback;
