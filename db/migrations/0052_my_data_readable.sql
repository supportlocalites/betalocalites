-- =============================================================================
-- Localites — migration 0052: fixes from the scenario tests, round 5, part 2b (D-54)
-- =============================================================================
-- M21, approved by the product owner on 19 October 2026: Download your data was "one long line
-- of text" and left out what someone did for a business. The site now also offers a readable
-- copy (site code), and the file has a section for the businesses they're or were on the team of:
--   their place on each team; messages they wrote for a business (their own words, the date
--   and the business, never who the customer was); changes they saved to a business's page
--   (from the change log, their own saves only); replies they wrote to reviews; photos they
--   added; and "this wasn't booked" notes they left, with the business and the date only.
-- Still not in it: the customers' side of those conversations, the reviews themselves, who a
-- booking was for, invitations they sent (other people's email addresses), and anything other
-- people on the team did.
--
-- my_data() from 0043 is kept, renamed my_data_0043 (no longer callable by the site), and the
-- new my_data() adds this section to what it returns.
--
-- Not destructive: one function renamed and one added, read only.
-- =============================================================================

set search_path = public, extensions;

alter function my_data() rename to my_data_0043;
revoke all on function my_data_0043() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0043();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'about', 'Your information on Localites, as of made_at: your account and details, events, guests, saved businesses, '
             || 'conversations, reviews, inquiries, suggestions, reports, business teams and claims, what you did for '
             || 'businesses you''re or were on the team of, and the latest 5,000 records of how you used Localites (and of '
             || 'your searches) from browsers only you have signed in on. For anything else, or the full record, email '
             || 'supportlocalites@gmail.com.',
    'for_your_businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business', v.display_name,
        'your_places_on_the_team', (select jsonb_agg(jsonb_build_object('role', bm.role, 'since', bm.created_at, 'until', bm.ended_at)
                                                     order by bm.created_at)
                                    from vendor_member bm where bm.vendor_id = v.id and bm.user_id = me),
        'messages_you_wrote', coalesce((
          select jsonb_agg(jsonb_build_object('sent', msg.created_at,
                             'message', case when msg.removed_at is not null then '(removed)' else msg.body end,
                             'edited', msg.edited_at, 'file', case when msg.removed_at is null then f.file_name end) order by msg.created_at)
          from message msg join conversation c on c.id = msg.conversation_id
          left join conversation_file f on f.message_id = msg.id
          where c.vendor_id = v.id and msg.author_user_id = me and msg.author_side = 'vendor'), '[]'),
        'page_changes_you_saved', coalesce((
          select jsonb_agg(jsonb_build_object('saved', a.created_at, 'held_for_our_team', a.action = 'vendor.owner_edit_held',
                             'changes', a.changes) order by a.created_at)
          from audit_log a
          where a.subject_type = 'vendor' and a.subject_id = v.id and a.actor_user_id = me
            and a.action in ('vendor.owner_edit', 'vendor.owner_edit_held')), '[]'),
        'review_replies_you_wrote', coalesce((
          select jsonb_agg(jsonb_build_object('replied', r.vendor_replied_at, 'reply', r.vendor_reply,
                             'removed_by_our_team', r.reply_removed_at is not null) order by r.vendor_replied_at)
          from review r where r.vendor_id = v.id and r.vendor_replied_by = me), '[]'),
        'photos_you_added', coalesce((
          select jsonb_agg(jsonb_build_object('added', ma.created_at, 'description', ma.alt_text,
                             'removed', ma.deleted_at) order by ma.created_at)
          from media_asset ma where ma.owner_kind = 'vendor' and ma.owner_id = v.id and ma.bucket = 'public' and ma.uploaded_by = me), '[]'),
        'not_booked_notes_you_left', coalesce((
          select jsonb_agg(jsonb_build_object('left', ev.vendor_flagged_at, 'note', n.note) order by ev.vendor_flagged_at)
          from event_vendor ev left join event_vendor_flag_note n on n.event_vendor_id = ev.id
          where ev.vendor_id = v.id and ev.vendor_flagged_by = me), '[]')
      ) order by t.first)
      from (select vendor_id, min(created_at) as first from vendor_member where user_id = me group by vendor_id) t
      join vendor v on v.id = t.vendor_id), '[]')
  );
end $$;

revoke all on function my_data(), my_data_0043() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0043() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data() to app_server;
