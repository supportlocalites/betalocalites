-- =============================================================================
-- Localites — migration 0061: Community (D-62)
-- =============================================================================
-- The product owner chose Community's feed look on 26 October 2026 ("I like A - feed"), with:
-- only people signed in post; names only, no neighbourhoods; up and down votes, the most up-voted
-- first ("down votes just help users see if there is disagreement"); an answer can suggest a
-- business (their favourites first, then search Localites, or type its name) or just give advice
-- ("they can answer without a business"); nobody is anonymous. And, 26 October: posts show
-- straight away, with the language check, a Report button, and the team able to take one down.
--
--   community_question  a question, by a person, optionally about one main kind of business.
--   community_answer    an answer: words, and at most one business, either one on Localites
--                       (vendor_id) or a name they typed. One answer per business on Localites
--                       per question ("already suggested: vote it up instead").
--   community_vote      one vote (up or down) per person per answer; never on their own. Who
--                       voted is private: only the counts on the answer are public.
--   community_report    a person reporting a question or answer, once each; the team decides.
--
-- Shown to everyone (signed out too): questions and answers with status 'shown'. A post the
-- language check flags is 'held': only its author and the team see it until the team shows it.
-- Only the team takes a post down ('removed'); an author can take down their own. A business's
-- team can't suggest their own business. An account deleted takes its posts down and its votes
-- and reports' names with it. Download your data includes all of it.
--
-- Not destructive: four tables, their rules, and my_data() wrapped (my_data_0058 kept, renamed).
-- =============================================================================

set search_path = public, extensions;

create table community_question (
  id              uuid primary key default gen_random_uuid(),
  author_user_id  uuid references app_user(id) on delete set null,
  title           text not null check (char_length(title) between 10 and 140 and title = btrim(title)),
  detail          text check (detail is null or (char_length(detail) between 1 and 600 and detail = btrim(detail))),
  category_id     uuid references category(id) on delete set null,
  status          text not null default 'shown' check (status in ('shown', 'held', 'removed')),
  language_flag   text check (char_length(language_flag) <= 500),
  removed_by      text check (removed_by in ('author', 'team', 'account_deleted')),
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint community_question_removed_whole check ((status = 'removed') = (removed_at is not null) and (removed_at is null) = (removed_by is null))
);
create index community_question_feed on community_question (created_at desc) where status = 'shown';
create index community_question_by_author on community_question (author_user_id);
comment on table community_question is 'Community (0061, D-62): a question anyone can read; only people signed in ask.';

create table community_answer (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references community_question(id) on delete cascade,
  author_user_id  uuid references app_user(id) on delete set null,
  body            text not null check (char_length(body) between 10 and 600 and body = btrim(body)),
  vendor_id       uuid references vendor(id) on delete set null,
  business_name   text check (business_name is null or (char_length(business_name) between 2 and 80 and business_name = btrim(business_name))),
  up_votes        integer not null default 0 check (up_votes >= 0),
  down_votes      integer not null default 0 check (down_votes >= 0),
  status          text not null default 'shown' check (status in ('shown', 'held', 'removed')),
  language_flag   text check (char_length(language_flag) <= 500),
  removed_by      text check (removed_by in ('author', 'team', 'account_deleted')),
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint community_answer_one_business check (vendor_id is null or business_name is null),
  constraint community_answer_removed_whole check ((status = 'removed') = (removed_at is not null) and (removed_at is null) = (removed_by is null))
);
create index community_answer_by_question on community_answer (question_id);
create index community_answer_by_author on community_answer (author_user_id);
-- One answer per business on Localites per question: a second is a vote for the first.
create unique index community_answer_one_per_business on community_answer (question_id, vendor_id)
  where vendor_id is not null and status <> 'removed';
comment on table community_answer is 'Community (0061): an answer, maybe suggesting one business. Vote counts kept here; who voted is private.';

create table community_vote (
  answer_id   uuid not null references community_answer(id) on delete cascade,
  user_id     uuid not null references app_user(id) on delete cascade,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (answer_id, user_id)
);
create index community_vote_by_person on community_vote (user_id);
comment on table community_vote is 'Community (0061): one vote per person per answer. Only the person sees their own.';

create table community_report (
  id                uuid primary key default gen_random_uuid(),
  question_id       uuid references community_question(id) on delete cascade,
  answer_id         uuid references community_answer(id) on delete cascade,
  reporter_user_id  uuid references app_user(id) on delete set null,
  reason            text not null check (reason in ('rude', 'untrue', 'spam', 'self_promotion', 'personal', 'other')),
  details           text check (details is null or (char_length(details) between 1 and 500)),
  decision          text check (decision in ('removed', 'kept')),
  decided_by        uuid references app_user(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint community_report_one_post check (num_nonnulls(question_id, answer_id) = 1),
  constraint community_report_decided_whole check ((decision is null) = (decided_at is null))
);
create unique index community_report_once on community_report (reporter_user_id, coalesce(question_id, answer_id))
  where reporter_user_id is not null;
create index community_report_open on community_report (created_at) where decision is null;
comment on table community_report is 'Community (0061): a person''s report of a question or answer, for the team.';

-- -----------------------------------------------------------------------------
-- Rules (for the website's own role; the database's owner and the team's tools aside)
-- -----------------------------------------------------------------------------

-- What can change once posted: an author takes their own down; the team shows, holds or takes
-- one down. The words, who wrote it and when never change.
create function community_post_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  is_question boolean := tg_table_name = 'community_question';
begin
  if current_user <> 'app_server' then return new; end if;
  if tg_op = 'INSERT' then
    if acting_side() is distinct from 'person' or new.author_user_id is distinct from acting_user() then
      raise exception 'only you can post as yourself' using errcode = 'LP101';
    end if;
    if new.status not in ('shown', 'held') or new.removed_at is not null then
      raise exception 'a new post is shown, or held for the team' using errcode = 'LP100';
    end if;
    if not is_question then
      if new.up_votes <> 0 or new.down_votes <> 0 then
        raise exception 'a new answer starts with no votes' using errcode = 'LP100';
      end if;
      if not exists (select 1 from community_question q where q.id = new.question_id and q.status = 'shown') then
        raise exception 'that question isn''t open for answers' using errcode = 'LP101';
      end if;
      if new.vendor_id is not null then
        if not exists (select 1 from vendor v where v.id = new.vendor_id and v.listing_status = 'published') then
          raise exception 'that business isn''t listed on Localites' using errcode = 'LP100';
        end if;
        -- A business can't praise itself.
        if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id and m.user_id = acting_user() and m.ended_at is null) then
          raise exception 'you can''t suggest a business you''re on the team of' using errcode = 'LP100';
        end if;
      end if;
    end if;
    return new;
  end if;
  -- An update.
  -- Only whether it's shown can change: the words, who wrote it, when, its business and votes never.
  if (to_jsonb(new) - '{status,removed_by,removed_at}'::text[]) <> (to_jsonb(old) - '{status,removed_by,removed_at}'::text[]) then
    raise exception 'a post''s words can''t be changed' using errcode = 'LP100';
  end if;
  if acting_as_team() then
    if new.status = 'removed' and new.removed_by is distinct from 'team' and old.status <> 'removed' then
      raise exception 'the team takes posts down as the team' using errcode = 'LP100';
    end if;
    if old.status = 'removed' and old.removed_by in ('author', 'account_deleted') and new.status <> 'removed' then
      raise exception 'a post its author took down stays down' using errcode = 'LP100';
    end if;
    return new;
  end if;
  if acting_side() = 'person' and old.author_user_id = acting_user()
     and old.status <> 'removed' and new.status = 'removed' and new.removed_by = 'author' then
    return new;
  end if;
  raise exception 'only the team, or its author taking it down, can change a post' using errcode = 'LP101';
end $$;
create trigger community_question_rules before insert or update on community_question
  for each row execute function community_post_rules();
create trigger community_answer_rules before insert or update on community_answer
  for each row execute function community_post_rules();

-- Votes: the person's own, on an answer that's shown and isn't theirs.
create function community_vote_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if acting_side() is distinct from 'person' or (case when tg_op = 'DELETE' then old.user_id else new.user_id end) is distinct from acting_user() then
    raise exception 'only you can vote as yourself' using errcode = 'LP101';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.answer_id <> old.answer_id or new.user_id <> old.user_id) then
    raise exception 'a vote can only change its way' using errcode = 'LP100';
  end if;
  if not exists (select 1 from community_answer a join community_question q on q.id = a.question_id
                 where a.id = new.answer_id and a.status = 'shown' and q.status = 'shown') then
    raise exception 'that answer isn''t shown' using errcode = 'LP101';
  end if;
  if exists (select 1 from community_answer a where a.id = new.answer_id and a.author_user_id = acting_user()) then
    raise exception 'you can''t vote on your own answer' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger community_vote_rules before insert or update or delete on community_vote
  for each row execute function community_vote_rules();

-- The counts on the answer follow the votes (the database's owner writes them, so nobody else can).
create function community_vote_counts() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update community_answer set up_votes = up_votes - (old.value = 1)::int, down_votes = down_votes - (old.value = -1)::int
    where id = old.answer_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update community_answer set up_votes = up_votes + (new.value = 1)::int, down_votes = down_votes + (new.value = -1)::int
    where id = new.answer_id;
  end if;
  return null;
end $$;
create trigger community_vote_counts after insert or update or delete on community_vote
  for each row execute function community_vote_counts();

-- Reports: a person, once per post, not their own, on a post they can see. Only the team decides.
create function community_report_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if tg_op = 'INSERT' then
    if acting_side() is distinct from 'person' or new.reporter_user_id is distinct from acting_user() then
      raise exception 'only you can report as yourself' using errcode = 'LP101';
    end if;
    if new.decision is not null or new.decided_by is not null then
      raise exception 'a new report waits for the team' using errcode = 'LP100';
    end if;
    if (new.question_id is not null and not exists (select 1 from community_question q where q.id = new.question_id and q.status = 'shown'))
       or (new.answer_id is not null and not exists (select 1 from community_answer a where a.id = new.answer_id and a.status = 'shown')) then
      raise exception 'that post isn''t shown' using errcode = 'LP101';
    end if;
    if exists (select 1 from community_question q where q.id = new.question_id and q.author_user_id = acting_user())
       or exists (select 1 from community_answer a where a.id = new.answer_id and a.author_user_id = acting_user()) then
      raise exception 'you can''t report your own post' using errcode = 'LP100';
    end if;
    return new;
  end if;
  if not acting_as_team() then
    raise exception 'only the Localites team decides reports' using errcode = 'LP101';
  end if;
  if new.id <> old.id or new.question_id is distinct from old.question_id or new.answer_id is distinct from old.answer_id
     or new.reporter_user_id is distinct from old.reporter_user_id or new.reason <> old.reason
     or new.details is distinct from old.details or new.created_at <> old.created_at
     or old.decision is not null or new.decided_by is distinct from acting_user() then
    raise exception 'only a report''s decision can be added, once' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger community_report_rules before insert or update on community_report
  for each row execute function community_report_rules();

-- An account deleted: its posts come down, its votes go (the counts follow), its reports keep no name.
create function community_goes_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update community_question set status = 'removed', removed_by = 'account_deleted', removed_at = now()
  where author_user_id = new.id and status <> 'removed';
  update community_answer set status = 'removed', removed_by = 'account_deleted', removed_at = now()
  where author_user_id = new.id and status <> 'removed';
  delete from community_vote where user_id = new.id;
  update community_report set reporter_user_id = null, details = null where reporter_user_id = new.id;
  return new;
end $$;
create trigger app_user_community_goes after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function community_goes_with_account();

-- -----------------------------------------------------------------------------
-- Who reads and writes what
-- -----------------------------------------------------------------------------
alter table community_question enable row level security;
alter table community_question force row level security;
alter table community_answer enable row level security;
alter table community_answer force row level security;
alter table community_vote enable row level security;
alter table community_vote force row level security;
alter table community_report enable row level security;
alter table community_report force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on community_question, community_answer, community_vote, community_report from %I', r);
    end if;
  end loop;
end $$;

-- Shown posts to everyone; held or taken down ones only to their author and the team (the pages
-- show an author's held post as waiting, and none taken down).
create policy community_question_read on community_question for select to app_server
  using (status = 'shown' or acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()));
create policy community_question_post on community_question for insert to app_server
  with check (acting_side() = 'person' and author_user_id = acting_user());
create policy community_question_change on community_question for update to app_server
  using (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()))
  with check (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()));

create policy community_answer_read on community_answer for select to app_server
  using (status = 'shown' or acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()));
create policy community_answer_post on community_answer for insert to app_server
  with check (acting_side() = 'person' and author_user_id = acting_user());
create policy community_answer_change on community_answer for update to app_server
  using (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()))
  with check (acting_as_team() or (acting_side() = 'person' and author_user_id = acting_user()));

create policy community_vote_own on community_vote for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());

create policy community_report_read on community_report for select to app_server
  using (acting_as_team() or (acting_side() = 'person' and reporter_user_id = acting_user()));
create policy community_report_post on community_report for insert to app_server
  with check (acting_side() = 'person' and reporter_user_id = acting_user());
create policy community_report_decide on community_report for update to app_server
  using (acting_as_team()) with check (acting_as_team());

revoke all on community_question, community_answer, community_vote, community_report from app_server;
grant select, insert (id, author_user_id, title, detail, category_id, status, language_flag),
  update (status, removed_by, removed_at) on community_question to app_server;
grant select, insert (id, question_id, author_user_id, body, vendor_id, business_name, status, language_flag),
  update (status, removed_by, removed_at) on community_answer to app_server;
grant select, insert (answer_id, user_id, value), update (value), delete on community_vote to app_server;
grant select, insert (id, question_id, answer_id, reporter_user_id, reason, details),
  update (decision, decided_by, decided_at) on community_report to app_server;

-- -----------------------------------------------------------------------------
-- Download your data: as 0058, plus Community
-- -----------------------------------------------------------------------------
alter function my_data() rename to my_data_0058;
revoke all on function my_data_0058() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0058();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'community_questions', coalesce((
      select jsonb_agg(jsonb_build_object('question', q.title, 'more', q.detail, 'status', q.status, 'asked', q.created_at)
             order by q.created_at)
      from community_question q where q.author_user_id = me), '[]'),
    'community_answers', coalesce((
      select jsonb_agg(jsonb_build_object('question', q.title, 'answer', a.body,
                                          'business', coalesce(v.display_name, a.business_name), 'status', a.status,
                                          'votes_up', a.up_votes, 'votes_down', a.down_votes, 'answered', a.created_at)
             order by a.created_at)
      from community_answer a join community_question q on q.id = a.question_id
      left join vendor v on v.id = a.vendor_id where a.author_user_id = me), '[]'),
    'community_votes', coalesce((
      select jsonb_agg(jsonb_build_object('answer', a.body, 'vote', case when cv.value = 1 then 'up' else 'down' end, 'when', cv.created_at)
             order by cv.created_at)
      from community_vote cv join community_answer a on a.id = cv.answer_id where cv.user_id = me), '[]'),
    'community_reports', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'details', r.details, 'decision', r.decision, 'reported', r.created_at)
             order by r.created_at)
      from community_report r where r.reporter_user_id = me), '[]'));
end $$;

revoke all on function my_data(), my_data_0058(), community_post_rules(), community_vote_rules(), community_vote_counts(),
  community_report_rules(), community_goes_with_account() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0058(), community_post_rules(), community_vote_rules(), community_vote_counts(), community_report_rules(), community_goes_with_account() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data() to app_server;
