-- =============================================================================
-- Checks for migration 0063: photos on Community posts, checked by the team first. Rolled back.
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
create function pg_temp.act(p_side text, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', '', true);
end $$;
create function pg_temp.photo(p_id text, p_question text, p_answer text, p_author text) returns text language sql as $$
  select format($f$insert into community_photo (id, question_id, answer_id, author_user_id, storage_path, mime_type, byte_size, width, height)
                   values (%L, %L, %L, %L, %L, 'image/jpeg', 1000, 800, 600)$f$,
                p_id, p_question, p_answer, p_author, 'community/' || p_id || '.jpg')
$$;

-- Pat (a1) asks with photos; Kim (a2) answers; Mia (a3) is anyone else; Ted (a5) is on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000063a1', 'Pat Q.', 'Pat', 'Quill', 'pat-63@example.com'),
  ('00000000-0000-7000-8000-0000000063a2', 'Kim R.', 'Kim', 'Reed', 'kim-63@example.com'),
  ('00000000-0000-7000-8000-0000000063a3', 'Mia T.', 'Mia', 'Tran', 'mia-63@example.com'),
  ('00000000-0000-7000-8000-0000000063a5', 'Ted U.', 'Ted', 'Ung', 'ted-63@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000063a5', 'admin');

set local role app_server;

select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a1');
insert into community_question (id, author_user_id, title) values
  ('00000000-0000-7000-8000-0000000063d1', '00000000-0000-7000-8000-0000000063a1', 'Who did this lovely cake?');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
insert into community_answer (id, question_id, author_user_id, body) values
  ('00000000-0000-7000-8000-0000000063e1', '00000000-0000-7000-8000-0000000063d1', '00000000-0000-7000-8000-0000000063a2', 'It looks like the bakery on the main street.');

-- ------------------------------------------------------------------ Adding
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a1');
do $$ begin execute pg_temp.photo('00000000-0000-7000-8000-0000000063f1', '00000000-0000-7000-8000-0000000063d1', null, '00000000-0000-7000-8000-0000000063a1'); end $$;
select pg_temp.expect('Pat adds a photo to her question: it waits for the team',
  (select status = 'pending' from community_photo where id = '00000000-0000-7000-8000-0000000063f1'));
select pg_temp.expect('…she sees it, waiting', (select count(*) = 1 from community_photo where id = '00000000-0000-7000-8000-0000000063f1'));
select pg_temp.expect_code('nobody adds a photo to someone else''s post',
  pg_temp.photo('00000000-0000-7000-8000-0000000063f9', null, '00000000-0000-7000-8000-0000000063e1', '00000000-0000-7000-8000-0000000063a1'), 'LP101');
select pg_temp.expect_code('…nor as someone else',
  pg_temp.photo('00000000-0000-7000-8000-0000000063f9', null, '00000000-0000-7000-8000-0000000063e1', '00000000-0000-7000-8000-0000000063a2'), 'LP101');
select pg_temp.expect_code('a new photo can''t say it''s already shown',
  $q$insert into community_photo (id, question_id, author_user_id, storage_path, mime_type, byte_size, status)
     values ('00000000-0000-7000-8000-0000000063f9', '00000000-0000-7000-8000-0000000063d1', '00000000-0000-7000-8000-0000000063a1',
             'community/00000000-0000-7000-8000-0000000063f9.jpg', 'image/jpeg', 1000, 'shown')$q$, '42501');
select pg_temp.expect_code('only a photo stored where Community keeps them',
  $q$insert into community_photo (id, question_id, author_user_id, storage_path, mime_type, byte_size)
     values ('00000000-0000-7000-8000-0000000063f9', '00000000-0000-7000-8000-0000000063d1', '00000000-0000-7000-8000-0000000063a1',
             'conversations/someone-else/file.jpg', 'image/jpeg', 1000)$q$, '23514');
do $$ begin
  execute pg_temp.photo('00000000-0000-7000-8000-0000000063f2', '00000000-0000-7000-8000-0000000063d1', null, '00000000-0000-7000-8000-0000000063a1');
  execute pg_temp.photo('00000000-0000-7000-8000-0000000063f3', '00000000-0000-7000-8000-0000000063d1', null, '00000000-0000-7000-8000-0000000063a1');
end $$;
select pg_temp.expect_code('a post has up to 3 photos',
  pg_temp.photo('00000000-0000-7000-8000-0000000063f4', '00000000-0000-7000-8000-0000000063d1', null, '00000000-0000-7000-8000-0000000063a1'), 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
do $$ begin execute pg_temp.photo('00000000-0000-7000-8000-0000000063f5', null, '00000000-0000-7000-8000-0000000063e1', '00000000-0000-7000-8000-0000000063a2'); end $$;
select pg_temp.expect('Kim adds one to her answer', (select status = 'pending' from community_photo where id = '00000000-0000-7000-8000-0000000063f5'));

-- ------------------------------------------------------------------ Seeing
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a3');
select pg_temp.expect('someone else sees none of the waiting photos', (select count(*) = 0 from community_photo));
select pg_temp.act(null, null);
select pg_temp.expect('…nor does someone signed out', (select count(*) = 0 from community_photo));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
select pg_temp.expect('…and Kim sees only her own', (select count(*) = 1 from community_photo));

-- ------------------------------------------------------------------ Deciding
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a1');
select pg_temp.expect_code('Pat can''t show her own photo',
  $q$update community_photo set status = 'shown', decided_by = '00000000-0000-7000-8000-0000000063a1', decided_at = now()
     where id = '00000000-0000-7000-8000-0000000063f1'$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a3');
update community_photo set status = 'removed', removed_by = 'author' where id = '00000000-0000-7000-8000-0000000063f5';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
select pg_temp.expect('Mia can''t take down Kim''s photo (nothing changes)', (select status = 'pending' from community_photo where id = '00000000-0000-7000-8000-0000000063f5'));
select pg_temp.act('team', '00000000-0000-7000-8000-0000000063a5');
select pg_temp.expect('the team sees every waiting photo', (select count(*) = 4 from community_photo where status = 'pending'));
select pg_temp.expect_code('the team decides as itself',
  $q$update community_photo set status = 'shown', decided_by = '00000000-0000-7000-8000-0000000063a1', decided_at = now()
     where id = '00000000-0000-7000-8000-0000000063f1'$q$, 'LP100');
update community_photo set status = 'shown', decided_by = '00000000-0000-7000-8000-0000000063a5', decided_at = now()
where id in ('00000000-0000-7000-8000-0000000063f1', '00000000-0000-7000-8000-0000000063f5');
update community_photo set status = 'removed', removed_by = 'team', decided_by = '00000000-0000-7000-8000-0000000063a5', decided_at = now()
where id = '00000000-0000-7000-8000-0000000063f2';
select pg_temp.expect_code('a photo itself never changes',
  $q$update community_photo set storage_path = 'community/00000000-0000-7000-8000-0000000063ff.jpg' where id = '00000000-0000-7000-8000-0000000063f1'$q$, '42501');
select pg_temp.expect_code('a photo taken down stays down',
  $q$update community_photo set status = 'shown', removed_by = null, decided_by = '00000000-0000-7000-8000-0000000063a5', decided_at = now()
     where id = '00000000-0000-7000-8000-0000000063f2'$q$, 'LP100');
select community_photo_storage_removed('00000000-0000-7000-8000-0000000063f1');
select pg_temp.expect('the housekeeping can''t mark a showing photo''s file as deleted',
  (select storage_removed_at is null and status = 'shown' from community_photo where id = '00000000-0000-7000-8000-0000000063f1'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a3');
select pg_temp.expect('once shown, everyone sees it (the question''s and the answer''s), not the waiting or taken-down ones',
  (select count(*) = 2 from community_photo) and (select bool_and(status = 'shown') from community_photo));
select pg_temp.act(null, null);
select pg_temp.expect('…signed out too', (select count(*) = 2 from community_photo));

-- ------------------------------------------------------------------ Posts and accounts
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
update community_answer set status = 'removed', removed_by = 'author', removed_at = now() where id = '00000000-0000-7000-8000-0000000063e1';
select pg_temp.act(null, null);
select pg_temp.expect('an answer taken down: its photo no longer shows', (select count(*) = 1 from community_photo));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a1');
update community_photo set status = 'removed', removed_by = 'author' where id = '00000000-0000-7000-8000-0000000063f3';
select pg_temp.expect('Pat takes one of hers down', (select status = 'removed' from community_photo where id = '00000000-0000-7000-8000-0000000063f3'));
reset role;
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000063a1';
select pg_temp.expect('Pat''s account deleted: all her photos come down',
  (select bool_and(status = 'removed') from community_photo where author_user_id = '00000000-0000-7000-8000-0000000063a1'));
set local role app_server;
select pg_temp.expect('the housekeeping finds every file to delete: taken down, deleted account, and the photo on an answer its author took down',
  (select count(*) = 4 from community_photos_to_remove(50)));
select community_photo_storage_removed(id) from community_photos_to_remove(50);
select pg_temp.expect('…and once deleted, nothing is left to do', (select count(*) = 0 from community_photos_to_remove(50))
  and community_photos_stored_bytes() = 0);
select pg_temp.expect('…each recorded with why: the team, its author, a deleted account',
  (select removed_by = 'team' from community_photo where id = '00000000-0000-7000-8000-0000000063f2')
  and (select removed_by = 'account_deleted' from community_photo where id = '00000000-0000-7000-8000-0000000063f1')
  and (select removed_by = 'author' from community_photo where id = '00000000-0000-7000-8000-0000000063f5'));

-- An answer's photo, under a question its author takes down: its file goes too.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a3');
insert into community_question (id, author_user_id, title) values
  ('00000000-0000-7000-8000-0000000063d2', '00000000-0000-7000-8000-0000000063a3', 'Who has the best balloon arches?');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
insert into community_answer (id, question_id, author_user_id, body) values
  ('00000000-0000-7000-8000-0000000063e2', '00000000-0000-7000-8000-0000000063d2', '00000000-0000-7000-8000-0000000063a2', 'The party shop does lovely ones.');
do $$ begin execute pg_temp.photo('00000000-0000-7000-8000-0000000063f6', null, '00000000-0000-7000-8000-0000000063e2', '00000000-0000-7000-8000-0000000063a2'); end $$;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a3');
update community_question set status = 'removed', removed_by = 'author', removed_at = now() where id = '00000000-0000-7000-8000-0000000063d2';
select pg_temp.expect('…the answer''s photo is found for deleting', (select count(*) = 1 from community_photos_to_remove(50) where id = '00000000-0000-7000-8000-0000000063f6'));

-- ------------------------------------------------------------------ Download your data
select pg_temp.act('person', '00000000-0000-7000-8000-0000000063a2');
select pg_temp.expect('Download your data lists Kim''s two photos (what and when, not the pictures)',
  jsonb_array_length(my_data() -> 'community_photos') = 2 and (my_data() -> 'community_photos' -> 0 ->> 'on') = 'answer'
  and (my_data() -> 'community_photos' -> 0 ->> 'status') is not null);

rollback;
