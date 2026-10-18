-- =============================================================================
-- Localites — migration 0043: Download my data
-- =============================================================================
-- The product owner, 18 October 2026 ("add all of them"): Canadian privacy law lets people ask
-- for a copy of the personal information we hold about them. my_data() returns it, as one
-- JSON document built here (so the site does no heavy work), for the person acting as
-- themselves (acting_side() = 'person', ADR-031) and nobody else:
--   their account and optional details, email choices, events (with the private details),
--   plans and bookings, guests, their questions and updates and the replies, saved businesses,
--   conversations with every message they can see (file names only, not the files), reviews,
--   inquiries, suggestions, reports they made, business teams and claims, and activity records
--   linked to them (the latest 5,000 of each kind). Activity on a browser someone else has also
--   signed in on counts only when it was done signed in as this person (a family computer is
--   shared); searches carry no account, so only those from browsers only they used.
-- Not in it (the page says the file has "your information, including…", and how to ask for the
-- rest): records of emails sent, the team's change log, a suspension's reason (the lawyer is
-- asked, PO-07), messages written for a business they work for, and reports others made.
-- Left out, as on their own pages: a business's private note about a booking (D-41), messages
-- the team hid from someone else, and a review the team denied (D-51: no trace for its author;
-- the lawyer is asked about this, PO-07).
--
-- Not destructive: one function, read only.
-- =============================================================================

set search_path = public, extensions;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  only_mine uuid[];
begin
  if acting_side() is distinct from 'person' or me is null
     or not exists (select 1 from app_user where id = me and deleted_at is null) then
    raise exception 'only you can download your own data' using errcode = 'LP101';
  end if;
  -- Browsers only this person has signed in on: what was done there signed out (and searches,
  -- which carry no account) is theirs. A browser someone else also signed in on is shared, so
  -- only what this person did while signed in is included from it.
  select coalesce(array_agg(va.visitor_id), '{}') into only_mine from visitor_account va
  where va.user_id = me
    and not exists (select 1 from visitor_account o where o.visitor_id = va.visitor_id and o.user_id <> me);
  return jsonb_build_object(
    'made_at', now(),
    'about', 'Your information on Localites, as of made_at: your account and details, events, guests, saved businesses, '
             || 'conversations, reviews, inquiries, suggestions, reports, business teams and claims, and the latest 5,000 records '
             || 'of how you used Localites (and of your searches) from browsers only you have signed in on. For anything else, '
             || 'or the full record, email supportlocalites@gmail.com.',
    'account', (select jsonb_build_object('name', u.display_name, 'first_name', u.given_name, 'last_name', u.family_name,
                                          'email', u.email, 'joined', u.created_at)
                from app_user u where u.id = me),
    'optional_details', (select to_jsonb(p) - 'user_id' from person_profile p where p.user_id = me),
    'email_choices', (select to_jsonb(c) - 'user_id' from email_choice c where c.user_id = me),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.event_date, 'start', e.start_time, 'end', e.end_time, 'town', m.name, 'kind', t.name,
        'guests_expected', e.guest_count_estimate, 'status', e.status, 'created', e.created_at,
        'name', p.title, 'place', p.venue_note, 'ages', nullif(concat_ws('–', p.age_range_min, p.age_range_max), ''),
        'budget', case when p.budget_cents is not null then to_char(p.budget_cents / 100.0, 'FM999999990.00') end,
        'notes', p.notes, 'message_to_guests', p.guest_message,
        'businesses', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'status', x.status,
                                  'booked_at', x.booked_at, 'business_says_not_right', x.vendor_flagged_at is not null) order by x.created_at)
                                from event_vendor x join vendor v on v.id = x.vendor_id where x.event_id = e.id), '[]'),
        'questions', coalesce((select jsonb_agg(q.question order by q.created_at) from event_question q where q.event_id = e.id), '[]'),
        'updates', coalesce((select jsonb_agg(jsonb_build_object('posted', w.created_at, 'update', w.body) order by w.created_at)
                             from event_update w where w.event_id = e.id), '[]'),
        'guests', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'email', g.email, 'phone', g.phone,
                              'reply', g.response, 'coming', g.party_size, 'note', g.reply_note, 'replied', g.replied_at,
                              'answers', coalesce((select jsonb_agg(jsonb_build_object('question', q.question, 'answer', a.answer))
                                                   from guest_answer a join event_question q on q.id = a.question_id
                                                   where a.guest_id = g.id), '[]')) order by g.created_at)
                            from guest g where g.event_id = e.id), '[]'),
        'group_link_replies', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'reply', r.response, 'coming', r.party_size,
                                          'note', r.reply_note, 'replied', r.created_at,
                                          'answers', coalesce((select jsonb_agg(jsonb_build_object('question', q.question, 'answer', a.answer))
                                                               from guest_answer a join event_question q on q.id = a.question_id
                                                               where a.group_reply_id = r.id), '[]')) order by r.created_at)
                                        from group_reply r where r.event_id = e.id), '[]')
      ) order by e.event_date)
      from event e
        left join event_private p on p.event_id = e.id
        left join municipality m on m.id = e.municipality_id
        left join event_type t on t.id = e.event_type_id
      where e.host_user_id = me), '[]'),
    'saved_businesses', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'saved', s.created_at) order by s.created_at)
                                  from saved_vendor s join vendor v on v.id = s.vendor_id where s.user_id = me), '[]'),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business', v.display_name, 'started', c.created_at, 'status', c.status, 'ended', c.ended_at,
        'messages', coalesce((select jsonb_agg(jsonb_build_object(
                                'from', case when msg.author_side = 'consumer' then 'you' else v.display_name end,
                                'sent', msg.created_at,
                                'message', case when msg.removed_at is not null then '(removed)' else msg.body end,
                                'file', f.file_name) order by msg.created_at)
                              from message msg left join conversation_file f on f.message_id = msg.id
                              where msg.conversation_id = c.id
                                and (msg.hidden_by_team_at is null or msg.author_user_id = me)), '[]')
      ) order by c.created_at)
      from conversation c join vendor v on v.id = c.vendor_id where c.consumer_user_id = me), '[]'),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'event_date', r.event_date, 'rating', r.rating,
                           'review', r.body, 'status', r.status, 'written', r.created_at, 'published', r.published_at,
                           'business_reply', case when r.reply_removed_at is null and r.reply_held_at is null then r.vendor_reply end)
                           order by r.created_at)
                         from review r join vendor v on v.id = r.vendor_id
                         where r.author_user_id = me and r.status <> 'declined'), '[]'),
    'inquiries', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'note', i.note, 'shared_event', i.shared_event,
                             'sent', i.created_at) order by i.created_at)
                           from vendor_interest i join vendor v on v.id = i.vendor_id where i.user_id = me), '[]'),
    'suggested_businesses', coalesce((select jsonb_agg(jsonb_build_object('business', s.business_name, 'website', s.website,
                                        'contact', s.contact, 'status', s.status, 'suggested', s.created_at) order by s.created_at)
                                      from vendor_suggestion s where s.suggested_by = me), '[]'),
    'reports_you_made', coalesce((
      select jsonb_agg(x order by x->>'made') from (
        select jsonb_build_object('about', 'a conversation or message', 'reason', mr.reason, 'details', mr.details,
                                  'status', mr.status, 'made', mr.created_at) as x
        from moderation_report mr where mr.reporter_user_id = me
        union all
        select jsonb_build_object('about', 'a review', 'reason', rr.reason, 'details', rr.details,
                                  'status', rr.status, 'made', rr.created_at)
        from review_report rr where rr.reporter_user_id = me) reports), '[]'),
    'business_teams', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'role', bm.role,
                                  'since', bm.created_at, 'until', bm.ended_at) order by bm.created_at)
                                from vendor_member bm join vendor v on v.id = bm.vendor_id where bm.user_id = me), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'relationship', cl.relationship,
                          'note', cl.claimant_note, 'status', cl.status, 'made', cl.created_at) order by cl.created_at)
                        from vendor_claim cl join vendor v on v.id = cl.vendor_id where cl.claimant_user_id = me), '[]'),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('when', a.occurred_at, 'what', a.kind, 'business', v.display_name, 'device', a.device,
                                          'town', a.visitor_town, 'province', a.visitor_region, 'came_from', a.source,
                                          'seconds', a.duration_seconds) order by a.occurred_at desc)
      from (select * from activity_event ae
            where ae.user_id = me
               or (ae.user_id is null and ae.visitor_id = any(only_mine))
            order by ae.occurred_at desc limit 5000) a
        left join vendor v on v.id = a.vendor_id), '[]'),
    'searches', coalesce((
      select jsonb_agg(jsonb_build_object('when', s.occurred_at, 'words', s.words, 'results', s.result_count, 'device', s.device,
                                          'town', s.visitor_town, 'province', s.visitor_region) order by s.occurred_at desc)
      from (select * from search_record sr
            where sr.visitor_id = any(only_mine)
            order by sr.occurred_at desc limit 5000) s), '[]')
  );
end $$;

revoke all on function my_data() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data() to app_server;
