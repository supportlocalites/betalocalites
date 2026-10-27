-- =============================================================================
-- Localites — migration 0063: photos on Community questions and answers (D-62)
-- =============================================================================
-- The product owner, 27 October 2026: "There should also be the ability to add photos to the
-- questions and allow users to add photos to the answers (photos need to be vetted before they
-- are posted) this will be a task in the admin part of our website to approve."
--
--   community_photo  a photo on a question or an answer, added by its author with the post: up
--                    to 3 a post, 10 a day each. It waits for the team ('pending'): until the team
--                    shows it, only its author and the team can see it. The team shows it or takes
--                    it down; its author can take it down. Stored privately (the conversation
--                    files' private folder, under community/), handed out by the site only after
--                    these rules say the person asking may see it, and only while its post shows.
--
-- A photo taken down (or its author's account deleted, or its post taken down by its author)
-- has its stored file deleted by the site's own housekeeping (community_photos_to_remove). A file
-- stored for a post the site then couldn't save is deleted straight away (only a crash in between
-- could leave one). Download your data lists a person's photos (not the pictures).
--
-- Not destructive: one table, its rules, housekeeping functions, and my_data() wrapped again
-- (my_data_0061 kept, renamed).
-- =============================================================================

set search_path = public, extensions;

create table community_photo (
  id                  uuid primary key,
  question_id         uuid references community_question(id) on delete cascade,
  answer_id           uuid references community_answer(id) on delete cascade,
  author_user_id      uuid not null references app_user(id),
  storage_path        text not null unique check (storage_path ~ '^community/[0-9a-f-]{36}\.(jpg|webp)$'),
  mime_type           text not null check (mime_type in ('image/jpeg', 'image/webp')),
  byte_size           int not null check (byte_size between 1 and 1048576),
  width               int check (width between 1 and 2048),
  height              int check (height between 1 and 2048),
  status              text not null default 'pending' check (status in ('pending', 'shown', 'removed')),
  removed_by          text check (removed_by in ('author', 'team', 'account_deleted')),
  decided_by          uuid references app_user(id),
  decided_at          timestamptz,
  storage_removed_at  timestamptz,
  created_at          timestamptz not null default now(),
  constraint community_photo_one_post check ((question_id is null) <> (answer_id is null)),
  constraint community_photo_removed_whole check ((status = 'removed') = (removed_by is not null))
);
create index community_photo_on_question on community_photo (question_id) where question_id is not null;
create index community_photo_on_answer on community_photo (answer_id) where answer_id is not null;
create index community_photo_by_author on community_photo (author_user_id, created_at);
create index community_photo_waiting on community_photo (created_at) where status = 'pending';
comment on table community_photo is
  'Community (0063): a photo on a question or answer. Waits for the team (pending) before anyone else sees it.';

-- What can be added and changed (for the website's own role; the database's owner aside).
create function community_photo_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if tg_op = 'INSERT' then
    if acting_side() is distinct from 'person' or new.author_user_id is distinct from acting_user() then
      raise exception 'only you can add photos as yourself' using errcode = 'LP101';
    end if;
    if new.status <> 'pending' or new.removed_by is not null or new.decided_by is not null or new.decided_at is not null
       or new.storage_removed_at is not null then
      raise exception 'a new photo waits for the team' using errcode = 'LP100';
    end if;
    -- One person's photos one at a time, so the limits below hold when they send several at once.
    perform pg_advisory_xact_lock(hashtext('community_photo:' || acting_user()::text));
    -- Only on their own post, while it isn't taken down.
    if (new.question_id is not null and not exists (
          select 1 from community_question q where q.id = new.question_id and q.author_user_id = acting_user() and q.status <> 'removed'))
       or (new.answer_id is not null and not exists (
          select 1 from community_answer a where a.id = new.answer_id and a.author_user_id = acting_user() and a.status <> 'removed')) then
      raise exception 'photos go on your own post' using errcode = 'LP101';
    end if;
    if (select count(*) from community_photo p
        where p.status <> 'removed' and (p.question_id = new.question_id or p.answer_id = new.answer_id)) >= 3 then
      raise exception 'a post can have up to 3 photos' using errcode = 'LP100';
    end if;
    if (select count(*) from community_photo p where p.author_user_id = acting_user() and p.created_at > now() - interval '1 day') >= 10 then
      raise exception 'that''s 10 photos today: please try again tomorrow' using errcode = 'LP100';
    end if;
    return new;
  end if;
  -- An update: only whether it's shown, and who decided, can change.
  if (to_jsonb(new) - '{status,removed_by,decided_by,decided_at}'::text[])
     <> (to_jsonb(old) - '{status,removed_by,decided_by,decided_at}'::text[]) then
    raise exception 'a photo itself can''t be changed' using errcode = 'LP100';
  end if;
  if old.status = 'removed' then
    raise exception 'a photo taken down stays down' using errcode = 'LP100';
  end if;
  if acting_as_team() then
    if new.decided_by is distinct from acting_user() or new.decided_at is null then
      raise exception 'the team decides as itself' using errcode = 'LP100';
    end if;
    if new.status = 'shown' and old.status = 'pending' and new.removed_by is null then return new; end if;
    if new.status = 'removed' and new.removed_by = 'team' then return new; end if;
    raise exception 'the team shows a waiting photo, or takes one down' using errcode = 'LP100';
  end if;
  if acting_side() = 'person' and old.author_user_id = acting_user()
     and new.status = 'removed' and new.removed_by = 'author'
     and new.decided_by is not distinct from old.decided_by and new.decided_at is not distinct from old.decided_at then
    return new;
  end if;
  raise exception 'only the team, or its author taking it down, can change a photo' using errcode = 'LP101';
end $$;
create trigger community_photo_rules before insert or update on community_photo
  for each row execute function community_photo_rules();

-- An account deleted: its photos come down (their files are then deleted by the housekeeping).
create function community_photos_go_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update community_photo set status = 'removed', removed_by = 'account_deleted'
  where author_user_id = new.id and status <> 'removed';
  return new;
end $$;
create trigger app_user_community_photos_go after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function community_photos_go_with_account();

-- -----------------------------------------------------------------------------
-- Who reads and writes what
-- -----------------------------------------------------------------------------
alter table community_photo enable row level security;
alter table community_photo force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on community_photo from %I', r);
    end if;
  end loop;
end $$;

-- Everyone: a photo the team showed, on a post that's shown (an answer's question too). Its author
-- and the team: theirs, or all.
create policy community_photo_read on community_photo for select to app_server
  using (
    acting_as_team()
    or (acting_side() = 'person' and author_user_id = acting_user())
    or (status = 'shown' and (
          exists (select 1 from community_question q where q.id = question_id and q.status = 'shown')
          or exists (select 1 from community_answer a join community_question q on q.id = a.question_id
                     where a.id = answer_id and a.status = 'shown' and q.status = 'shown'))));
create policy community_photo_add on community_photo for insert to app_server
  with check (acting_side() = 'person' and author_user_id = acting_user());
create policy community_photo_change on community_photo for update to app_server
  using (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()))
  with check (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()));

revoke all on community_photo from app_server;
grant select, insert (id, question_id, answer_id, author_user_id, storage_path, mime_type, byte_size, width, height),
  update (status, removed_by, decided_by, decided_at) on community_photo to app_server;

-- -----------------------------------------------------------------------------
-- Housekeeping the site does: stored files to delete, and what they all take up
-- -----------------------------------------------------------------------------
-- Why a photo's stored file can go, if it can: the photo was taken down, or its post (or an
-- answer's question) was taken down by its author or with a deleted account. Not a post the team
-- took down (the team can show it again). Null: it stays.
create function community_photo_gone_because(p_photo uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case
    when p.status = 'removed' then p.removed_by
    when q.status = 'removed' and q.removed_by in ('author', 'account_deleted') then q.removed_by
    when a.status = 'removed' and a.removed_by in ('author', 'account_deleted') then a.removed_by
    when aq.status = 'removed' and aq.removed_by in ('author', 'account_deleted') then aq.removed_by
  end
  from community_photo p
  left join community_question q on q.id = p.question_id
  left join community_answer a on a.id = p.answer_id
  left join community_question aq on aq.id = a.question_id
  where p.id = p_photo
$$;

create function community_photos_to_remove(p_limit int)
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.storage_path from community_photo p
  where p.storage_removed_at is null and community_photo_gone_because(p.id) is not null
  order by p.created_at limit least(greatest(p_limit, 0), 50)
$$;

-- After the site deleted the stored file: recorded, only for a photo whose file could go.
create function community_photo_storage_removed(p_photo uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  why text := community_photo_gone_because(p_photo);
begin
  if why is null then return; end if;
  update community_photo set storage_removed_at = now(), status = 'removed', removed_by = coalesce(removed_by, why)
  where id = p_photo and storage_removed_at is null;
end $$;

-- What Community's photos take up, for the site-wide limit (shared with conversation files).
create function community_photos_stored_bytes() returns bigint
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(byte_size), 0)::bigint from community_photo where storage_removed_at is null
$$;

-- -----------------------------------------------------------------------------
-- Download your data: as 0061, plus Community photos (what and when, not the pictures)
-- -----------------------------------------------------------------------------
alter function my_data() rename to my_data_0061;
revoke all on function my_data_0061() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0061();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'community_photos', coalesce((
      select jsonb_agg(jsonb_build_object('on', case when p.question_id is not null then 'question' else 'answer' end,
                                          'status', p.status, 'added', p.created_at)
             order by p.created_at)
      from community_photo p where p.author_user_id = me), '[]'));
end $$;

revoke all on function my_data(), my_data_0061(), community_photo_rules(), community_photos_go_with_account(), community_photo_gone_because(uuid),
  community_photos_to_remove(int), community_photo_storage_removed(uuid), community_photos_stored_bytes() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0061(), community_photo_rules(), community_photos_go_with_account(), community_photo_gone_because(uuid), community_photos_to_remove(int), community_photo_storage_removed(uuid), community_photos_stored_bytes() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data(), community_photos_to_remove(int), community_photo_storage_removed(uuid),
  community_photos_stored_bytes() to app_server;
