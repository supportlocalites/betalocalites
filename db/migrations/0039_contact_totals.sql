-- =============================================================================
-- Localites — migration 0039: messages and inquiries in a business's numbers (D-52)
-- =============================================================================
-- D-52 (the product owner, 18 October 2026: "Show businesses too"): a business's Analytics page
-- (when the team has switched it on, D-37) and the team's Activity page show, for a period:
--   inquiries     people who asked our team about the business before it joined (ADR-024);
--   conversations new conversations people started with it;
--   messages      messages people sent it;
--   replied       of those conversations, how many the business replied to, and the median
--                 time to its first reply (minutes).
-- Totals only: never who, never what was said. Conversations of an earlier team (ended when
-- the business stopped being claimed, 0025) aren't counted, so a new owner never sees the last
-- team's numbers; nor are messages its author removed.
--
-- Not destructive: one read-only function.
-- =============================================================================

set search_path = public, extensions;

create function vendor_contact_totals(p_vendor uuid, p_from date, p_to date)
returns table (inquiries int, conversations int, messages int, replied int, median_reply_minutes int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with bounds as (
    select (p_from::timestamp at time zone 'America/Toronto') as t0, (p_to::timestamp at time zone 'America/Toronto') as t1
  ),
  convs as (
    select c.id, c.created_at,
           (select min(m.created_at) from message m where m.conversation_id = c.id and m.author_side = 'vendor') as first_reply,
           (select min(m.created_at) from message m where m.conversation_id = c.id and m.author_side = 'consumer') as first_ask
    from conversation c, bounds b
    where c.vendor_id = p_vendor and c.created_at >= b.t0 and c.created_at < b.t1
      and c.ended_reason is distinct from 'business_left'
  )
  select
    (select count(*)::int from vendor_interest i, bounds b
      where i.vendor_id = p_vendor and i.created_at >= b.t0 and i.created_at < b.t1),
    (select count(*)::int from convs),
    (select count(*)::int from message m join conversation c on c.id = m.conversation_id, bounds b
      where c.vendor_id = p_vendor and c.ended_reason is distinct from 'business_left'
        and m.author_side = 'consumer' and m.removed_at is null and m.created_at >= b.t0 and m.created_at < b.t1),
    (select count(*)::int from convs where first_reply is not null),
    (select round(extract(epoch from percentile_cont(0.5) within group (order by first_reply - first_ask)) / 60)::int
     from convs where first_reply is not null and first_ask is not null and first_reply > first_ask)
$$;

revoke all on function vendor_contact_totals(uuid, date, date) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function vendor_contact_totals(uuid, date, date) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function vendor_contact_totals(uuid, date, date) to app_server;
