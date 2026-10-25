-- =============================================================================
-- Checks for migration 0057: groups in Messages (D-62). Rolled back.
-- =============================================================================

begin;

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
end $$;
create function pg_temp.expect_code(label text, stmt text, code text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL  %: rejected with % (%), want %', label, sqlstate, sqlerrm, code;
    end if;
    raise notice 'PASS  %  (refused: %)', label, code;
    return;
  end;
  raise exception 'FAIL  %: was accepted, want %', label, code;
end $$;
create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

-- Pat (a1) and Kim (a2) are people; Owen (a3) runs business c1.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000057a1', 'Pat Q.', 'Pat', 'Quill', 'pat-57@example.com'),
  ('00000000-0000-7000-8000-0000000057a2', 'Kim R.', 'Kim', 'Reed', 'kim-57@example.com'),
  ('00000000-0000-7000-8000-0000000057a3', 'Owen S.', 'Owen', 'Stone', 'owen-57@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000057b1', 'test-town-57', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000057c1', 'test-57-v', 'Vee Fifty Seven', '00000000-0000-7000-8000-0000000057b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000057c2', 'test-57-w', 'Wes Fifty Seven', '00000000-0000-7000-8000-0000000057b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values ('00000000-0000-7000-8000-0000000057c1', '00000000-0000-7000-8000-0000000057a3', 'owner');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-0000000057d1', '00000000-0000-7000-8000-0000000057a1', '00000000-0000-7000-8000-0000000057c1'),
  ('00000000-0000-7000-8000-0000000057d2', '00000000-0000-7000-8000-0000000057a1', '00000000-0000-7000-8000-0000000057c2'),
  ('00000000-0000-7000-8000-0000000057d3', '00000000-0000-7000-8000-0000000057a2', '00000000-0000-7000-8000-0000000057c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-0000000057e1', '00000000-0000-7000-8000-0000000057d1', '00000000-0000-7000-8000-0000000057a1', 'consumer', 'Free on the 14th?'),
  ('00000000-0000-7000-8000-0000000057e2', '00000000-0000-7000-8000-0000000057d2', '00000000-0000-7000-8000-0000000057a1', 'consumer', 'Free on the 14th?'),
  ('00000000-0000-7000-8000-0000000057e3', '00000000-0000-7000-8000-0000000057d3', '00000000-0000-7000-8000-0000000057a2', 'consumer', 'Hello'),
  ('00000000-0000-7000-8000-0000000057e4', '00000000-0000-7000-8000-0000000057d1', '00000000-0000-7000-8000-0000000057a3', 'vendor', 'Yes we are!');

-- Past Message alls (the migration's grouping, run again here on these rows). Lee sent the same
-- words to two businesses a moment apart (a Message all), and "Thanks so much…" to both three
-- hours apart (not one), and "Thanks!" to both at once (too short to tell). Dee's account is deleted.
insert into app_user (id, display_name, given_name, family_name, email, deleted_at) values
  ('00000000-0000-7000-8000-0000000057a4', 'Lee T.', 'Lee', 'Tan', 'lee-57@example.com', null),
  ('00000000-0000-7000-8000-0000000057a5', 'Dee U.', 'Dee', 'Underhill', 'dee-57@example.com', null);
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-0000000057d4', '00000000-0000-7000-8000-0000000057a4', '00000000-0000-7000-8000-0000000057c1'),
  ('00000000-0000-7000-8000-0000000057d5', '00000000-0000-7000-8000-0000000057a4', '00000000-0000-7000-8000-0000000057c2'),
  ('00000000-0000-7000-8000-0000000057d6', '00000000-0000-7000-8000-0000000057a5', '00000000-0000-7000-8000-0000000057c1'),
  ('00000000-0000-7000-8000-0000000057d7', '00000000-0000-7000-8000-0000000057a5', '00000000-0000-7000-8000-0000000057c2');
insert into message (conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-0000000057d4', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Are you free on Saturday the 14th?', '2026-10-20 14:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d5', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Are you free on Saturday the 14th?', '2026-10-20 14:00:01+00'),
  ('00000000-0000-7000-8000-0000000057d4', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Thanks so much for all of this!', '2026-10-20 15:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d5', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Thanks so much for all of this!', '2026-10-20 18:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d4', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Thanks!', '2026-10-20 19:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d5', '00000000-0000-7000-8000-0000000057a4', 'consumer', 'Thanks!', '2026-10-20 19:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d6', '00000000-0000-7000-8000-0000000057a5', 'consumer', 'Are you free on Saturday the 14th?', '2026-10-20 14:00:00+00'),
  ('00000000-0000-7000-8000-0000000057d7', '00000000-0000-7000-8000-0000000057a5', 'consumer', 'Are you free on Saturday the 14th?', '2026-10-20 14:00:01+00');
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000057a5';
select pg_temp.expect('past Message alls: one group, made once',
  (select group_past_message_alls() = 1) and (select group_past_message_alls() = 0));
select pg_temp.expect('…Lee''s Message all, called by its day, with both businesses and both messages marked',
  (select count(*) = 1 from message_group where user_id = '00000000-0000-7000-8000-0000000057a4' and name = 'Message all · 20 Oct')
  and (select count(*) = 2 from message_group_member gm join message_group g on g.id = gm.group_id where g.user_id = '00000000-0000-7000-8000-0000000057a4')
  and (select count(*) = 2 from message_group_send s join message_group g on g.id = s.group_id where g.user_id = '00000000-0000-7000-8000-0000000057a4'));
select pg_temp.expect('…not the same thanks hours apart, nor a short "Thanks!", nor a deleted account',
  (select count(*) = 0 from message_group where user_id = '00000000-0000-7000-8000-0000000057a5')
  and (select count(*) = 0 from message_group_send s join message m on m.id = s.message_id where m.body like 'Thanks%'));
select pg_temp.expect_code('the site can''t run the grouping',
  $q$set local role app_server; select group_past_message_alls()$q$, '42501');
reset role;

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000057a1');
insert into message_group (id, user_id, name) values ('00000000-0000-7000-8000-0000000057f1', '00000000-0000-7000-8000-0000000057a1', 'Dinosaur party');
select pg_temp.expect('Pat makes a group of their own', (select count(*) = 1 from message_group where id = '00000000-0000-7000-8000-0000000057f1'));
select pg_temp.expect_code('…never one for someone else',
  $q$insert into message_group (user_id, name) values ('00000000-0000-7000-8000-0000000057a2', 'Theirs')$q$, 'LP101');
select pg_temp.expect_code('a group needs a name (blank isn''t one)',
  $q$insert into message_group (user_id, name) values ('00000000-0000-7000-8000-0000000057a1', '  ')$q$, '23514');
select pg_temp.expect_code('…of at most 60 letters',
  $q$insert into message_group (user_id, name) values ('00000000-0000-7000-8000-0000000057a1', repeat('n', 61))$q$, '23514');
insert into message_group_member (group_id, conversation_id) values
  ('00000000-0000-7000-8000-0000000057f1', '00000000-0000-7000-8000-0000000057d1'),
  ('00000000-0000-7000-8000-0000000057f1', '00000000-0000-7000-8000-0000000057d2');
select pg_temp.expect('Pat puts their own two conversations in it', (select count(*) = 2 from message_group_member));
select pg_temp.expect_code('…never someone else''s conversation',
  $q$insert into message_group_member (group_id, conversation_id) values ('00000000-0000-7000-8000-0000000057f1', '00000000-0000-7000-8000-0000000057d3')$q$, 'LP101');
insert into message_group_send (message_id, group_id) values ('00000000-0000-7000-8000-0000000057e1', '00000000-0000-7000-8000-0000000057f1');
select pg_temp.expect('Pat marks their own message as sent with the group', (select count(*) = 1 from message_group_send));
select pg_temp.expect_code('…not the business''s reply',
  $q$insert into message_group_send (message_id, group_id) values ('00000000-0000-7000-8000-0000000057e4', '00000000-0000-7000-8000-0000000057f1')$q$, 'LP101');
select pg_temp.expect_code('…nor someone else''s message',
  $q$insert into message_group_send (message_id, group_id) values ('00000000-0000-7000-8000-0000000057e3', '00000000-0000-7000-8000-0000000057f1')$q$, 'LP101');
update message_group set name = 'Theo''s dinosaur party' where id = '00000000-0000-7000-8000-0000000057f1';
select pg_temp.expect('Pat renames it', (select name = 'Theo''s dinosaur party' from message_group where id = '00000000-0000-7000-8000-0000000057f1'));
select pg_temp.expect_code('…but can''t hand it to someone else',
  $q$update message_group set user_id = '00000000-0000-7000-8000-0000000057a2'$q$, '42501');
select pg_temp.expect_code('the site can''t delete groups (no way to yet)',
  $q$delete from message_group$q$, '42501');
select pg_temp.expect('Download your data has the group and its businesses',
  (select my_data()->'message_groups'->0->>'name' = 'Theo''s dinosaur party'
      and jsonb_array_length(my_data()->'message_groups'->0->'businesses') = 2));

-- Kim, and the business, see none of it and can't add to it.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000057a2');
select pg_temp.expect('Kim sees none of Pat''s groups, members or marks',
  (select count(*) = 0 from message_group) and (select count(*) = 0 from message_group_member) and (select count(*) = 0 from message_group_send));
select pg_temp.expect_code('Kim can''t put a conversation in Pat''s group',
  $q$insert into message_group_member (group_id, conversation_id) values ('00000000-0000-7000-8000-0000000057f1', '00000000-0000-7000-8000-0000000057d3')$q$, 'LP101');
update message_group set name = 'Mine now';
reset role;
select pg_temp.expect('Kim''s rename of Pat''s group changes nothing',
  (select name = 'Theo''s dinosaur party' from message_group where id = '00000000-0000-7000-8000-0000000057f1'));
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000057a3', '00000000-0000-7000-8000-0000000057c1');
select pg_temp.expect('the business sees no groups, names or marks',
  (select count(*) = 0 from message_group) and (select count(*) = 0 from message_group_member) and (select count(*) = 0 from message_group_send));
select pg_temp.expect_code('…and can''t make one',
  $q$insert into message_group (user_id, name) values ('00000000-0000-7000-8000-0000000057a3', 'Customers')$q$, 'LP101');
select pg_temp.act(null, null);
select pg_temp.expect('signed out, nothing', (select count(*) = 0 from message_group));

-- A conversation deleted (the scheduled deletions) takes its rows; an account deleted, its groups.
reset role;
delete from message where conversation_id = '00000000-0000-7000-8000-0000000057d1';
delete from conversation where id = '00000000-0000-7000-8000-0000000057d1';
select pg_temp.expect('a deleted conversation leaves the group, its mark too',
  (select count(*) = 1 from message_group_member where group_id = '00000000-0000-7000-8000-0000000057f1')
  and (select count(*) = 0 from message_group_send where group_id = '00000000-0000-7000-8000-0000000057f1'));
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000057a1';
select pg_temp.expect('an account deleted: its groups go with it',
  (select count(*) = 0 from message_group where user_id = '00000000-0000-7000-8000-0000000057a1')
  and (select count(*) = 0 from message_group_member where conversation_id = '00000000-0000-7000-8000-0000000057d2'));

rollback;
