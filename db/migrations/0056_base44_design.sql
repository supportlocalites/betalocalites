-- =============================================================================
-- Localites — migration 0056: the Base44 design (D-59) and the new kinds of business (D-60)
-- =============================================================================
-- The product owner, 22 October 2026: "I want to use the base44's website exactly as is",
-- with the choices in D-59, and a new list of kinds of business (D-60): six main kinds, each
-- with its own kinds within.
--
-- 1. The new kinds of business. The six main kinds and their 42 kinds within are added. The
--    old kinds (Venue, Food & Beverage, Sweets, Rentals & Decor, Activities, Photography and
--    theirs) are hidden, never deleted (0017): every business keeps its old kinds, and gets the
--    nearest new one as its main kind. Each move is written to audit_log ('vendor.kind_moved',
--    with the old and new main kind), so it can be undone exactly: make the old kinds active
--    again and set each business's main kind back to the one recorded (its link is still there).
--    A kind the team already made with one of the new web addresses is kept (and shown) as it is.
--    Businesses whose only kinds are ones the team added stay where they are; the team gives
--    them a new kind from the listing page (they aren't in a row until then).
-- 2. Three details the Base44 profile shows, set by our team (and later by owners):
--      vendor.neighbourhood   the part of town, like "Downtown" or "West Ridge";
--      vendor.tags            up to 6 short words, like "Seats 80" or "Nut free";
--      vendor.curator_note    a tip from our team, shown as "Curator's note".
-- 3. published_reply_times(): each listed business's usual time to first reply, for the cards
--    and the "Fastest reply" order (D-59, K12: the owner chose to show it to everyone). The
--    middle value over the past year, only from 3 answered conversations; nothing about who.
--
-- Not destructive: new rows and columns; the old kinds are hidden, and nothing is deleted.
-- =============================================================================

set search_path = public, extensions;

-- 1. The new kinds -------------------------------------------------------------------------

insert into category (slug, name, sort_order) values
  ('parties-and-celebrations',   'Parties & Celebrations',   1),
  ('health-and-wellness',        'Health & Wellness',        2),
  ('spiritual-and-holistic',     'Spiritual & Holistic',     3),
  ('beauty-and-personal-care',   'Beauty & Personal Care',   4),
  ('kids-and-family',            'Kids & Family',            5),
  ('home-and-everyday-services', 'Home & Everyday Services', 6)
on conflict (slug) do nothing;

insert into category (parent_id, slug, name, sort_order)
select p.id, c.slug, c.name, c.sort_order
from (values
  ('parties-and-celebrations', 'cakes-and-treats',               'Cakes & Treats',               1),
  ('parties-and-celebrations', 'florals-and-decor',              'Florals & Decor',              2),
  ('parties-and-celebrations', 'venues',                         'Venues',                       3),
  ('parties-and-celebrations', 'photography-and-video',          'Photography & Video',          4),
  ('parties-and-celebrations', 'entertainment',                  'Entertainment',                5),
  ('parties-and-celebrations', 'food-and-catering',              'Food & Catering',              6),
  ('parties-and-celebrations', 'event-planning',                 'Event Planning',               7),
  ('parties-and-celebrations', 'funerals-and-memorials',         'Funerals & Memorials',         8),
  ('health-and-wellness',      'massage-and-bodywork',           'Massage & Bodywork',           1),
  ('health-and-wellness',      'physio-and-rehab',               'Physio & Rehab',               2),
  ('health-and-wellness',      'chiropractic-and-naturopathy',   'Chiropractic & Naturopathy',   3),
  ('health-and-wellness',      'fitness-and-training',           'Fitness & Training',           4),
  ('health-and-wellness',      'nutrition',                      'Nutrition',                    5),
  ('health-and-wellness',      'mental-health-and-counselling',  'Mental Health & Counselling',  6),
  ('spiritual-and-holistic',   'energy-healing',                 'Energy Healing',               1),
  ('spiritual-and-holistic',   'tarot-and-readings',             'Tarot & Readings',             2),
  ('spiritual-and-holistic',   'breathwork-and-meditation',      'Breathwork & Meditation',      3),
  ('spiritual-and-holistic',   'somatic-and-spiritual-guidance', 'Somatic & Spiritual Guidance', 4),
  ('beauty-and-personal-care', 'hair',                           'Hair',                         1),
  ('beauty-and-personal-care', 'nails',                          'Nails',                        2),
  ('beauty-and-personal-care', 'brows-and-lashes',               'Brows & Lashes',               3),
  ('beauty-and-personal-care', 'skin-and-facials',               'Skin & Facials',               4),
  ('beauty-and-personal-care', 'aesthetics-and-injectables',     'Aesthetics & Injectables',     5),
  ('beauty-and-personal-care', 'waxing-and-hair-removal',        'Waxing & Hair Removal',        6),
  ('beauty-and-personal-care', 'tanning',                        'Tanning',                      7),
  ('beauty-and-personal-care', 'teeth-whitening',                'Teeth Whitening',              8),
  ('beauty-and-personal-care', 'spa-and-relaxation',             'Spa & Relaxation',             9),
  ('kids-and-family',          'play-centres-and-indoor-play',   'Play Centres & Indoor Play',   1),
  ('kids-and-family',          'sports-and-recreation',          'Sports & Recreation',          2),
  ('kids-and-family',          'childcare-and-daycare',          'Childcare & Daycare',          3),
  ('kids-and-family',          'education-and-tutoring',         'Education & Tutoring',         4),
  ('kids-and-family',          'kids-haircuts',                  'Kids’ Haircuts',               5),
  ('kids-and-family',          'baby-and-maternity',             'Baby & Maternity',             6),
  ('kids-and-family',          'parenting-and-family-support',   'Parenting & Family Support',   7),
  ('kids-and-family',          'kids-health-and-therapy',        'Kids’ Health & Therapy',       8),
  ('home-and-everyday-services', 'cleaning-and-decluttering',    'Cleaning & Decluttering',      1),
  ('home-and-everyday-services', 'lawn-and-garden',              'Lawn & Garden',                2),
  ('home-and-everyday-services', 'snow-removal',                 'Snow Removal',                 3),
  ('home-and-everyday-services', 'plumbing-and-electrical',      'Plumbing & Electrical',        4),
  ('home-and-everyday-services', 'heating-and-cooling',          'Heating & Cooling',            5),
  ('home-and-everyday-services', 'home-repairs-and-maintenance', 'Home Repairs & Maintenance',   6),
  ('home-and-everyday-services', 'pet-care',                     'Pet Care',                     7)
) as c(parent_slug, slug, name, sort_order)
join category p on p.slug = c.parent_slug
on conflict (slug) do nothing;

-- Each old kind's nearest new one. Kinds the team added since 0002 aren't in this list: their
-- businesses keep them, and the team gives them a new kind from the listing page.
create temporary table kind_move (old_slug text primary key, new_slug text not null) on commit drop;
insert into kind_move values
  ('venue', 'venues'), ('party-rooms', 'venues'), ('halls', 'venues'), ('event-spaces', 'venues'),
  ('activity-centres', 'venues'), ('indoor-play', 'play-centres-and-indoor-play'),
  ('food-and-beverage', 'food-and-catering'), ('caterers', 'food-and-catering'), ('food-trucks', 'food-and-catering'),
  ('party-trays', 'food-and-catering'), ('mobile-bars', 'food-and-catering'),
  ('sweets', 'cakes-and-treats'), ('custom-cakes', 'cakes-and-treats'), ('cupcakes', 'cakes-and-treats'),
  ('cookies', 'cakes-and-treats'), ('chocolates', 'cakes-and-treats'), ('dessert-tables', 'cakes-and-treats'),
  ('ice-cream', 'cakes-and-treats'),
  ('rentals-and-decor', 'florals-and-decor'), ('tents-tables-chairs', 'florals-and-decor'), ('balloons', 'florals-and-decor'),
  ('decor', 'florals-and-decor'), ('bouncy-castles', 'entertainment'), ('photo-booths', 'photography-and-video'),
  ('activities', 'entertainment'), ('face-painting', 'entertainment'), ('magicians', 'entertainment'),
  ('balloon-twisting', 'entertainment'), ('characters', 'entertainment'), ('djs-and-music', 'entertainment'),
  ('animal-shows', 'entertainment'), ('crafts', 'entertainment'), ('science', 'entertainment'),
  ('sports', 'sports-and-recreation'),
  ('photography', 'photography-and-video'), ('photographers', 'photography-and-video'), ('videographers', 'photography-and-video');

-- Every business with an old kind gets the new one too (its old links stay).
insert into vendor_category (vendor_id, category_id, is_primary)
select distinct vc.vendor_id, n.id, false
from vendor_category vc
join category o on o.id = vc.category_id
join kind_move m on m.old_slug = o.slug::text
join category n on n.slug = m.new_slug
on conflict (vendor_id, category_id) do nothing;

-- Its main kind moves to the new kind that matches its old main kind.
create temporary table main_move on commit drop as
select vc.vendor_id, n.id as new_id, o.slug::text as old_slug, n.slug::text as new_slug
from vendor_category vc
join category o on o.id = vc.category_id
join kind_move m on m.old_slug = o.slug::text
join category n on n.slug = m.new_slug
where vc.is_primary;
insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, changes)
select null, 'vendor.kind_moved', 'vendor', vendor_id, 'New kinds of business (D-60, migration 0056).',
       jsonb_build_object('primaryCategory', jsonb_build_object('from', old_slug, 'to', new_slug))
from main_move;
update vendor_category vc set is_primary = false from main_move mm where vc.vendor_id = mm.vendor_id and vc.is_primary;
update vendor_category vc set is_primary = true from main_move mm where vc.vendor_id = mm.vendor_id and vc.category_id = mm.new_id;

-- The old kinds are hidden (0017: hiding, never deleting).
update category set is_active = false where slug::text in (select old_slug from kind_move);

-- 2. Three details for the profile ---------------------------------------------------------

create function tags_are_tidy(p_tags text[]) returns boolean
language sql immutable set search_path = public, extensions as $$
  select coalesce(cardinality(p_tags), 0) <= 6
     and not exists (
       select 1 from unnest(p_tags) t
       where t is null or char_length(t) not between 1 and 24 or t <> btrim(t) or t ~ '[[:cntrl:]]')
     and (select count(distinct lower(t)) from unnest(p_tags) t) = coalesce(cardinality(p_tags), 0)
$$;

alter table vendor
  add column neighbourhood text check (char_length(neighbourhood) between 1 and 60 and neighbourhood = btrim(neighbourhood)),
  add column tags text[] not null default '{}' check (tags_are_tidy(tags)),
  add column curator_note text check (char_length(curator_note) between 1 and 280 and curator_note = btrim(curator_note));

comment on column vendor.neighbourhood is 'The part of town shown beside the kind on the profile (0056, D-59); none: the town is shown.';
comment on column vendor.tags is 'Up to 6 short words shown on the profile, like "Seats 80" (0056, D-59).';
comment on column vendor.curator_note is 'A tip from the Localites team, shown as "Curator''s note" (0056, D-59). Team only.';

-- 3. Usual time to first reply --------------------------------------------------------------

create function published_reply_times()
returns table (vendor_id uuid, reply_minutes int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with convs as (
    select c.vendor_id,
           (select min(m.created_at) from message m where m.conversation_id = c.id and m.author_side = 'consumer') as first_ask,
           (select min(m.created_at) from message m where m.conversation_id = c.id and m.author_side = 'vendor') as first_reply
    from conversation c
    join vendor v on v.id = c.vendor_id and v.listing_status = 'published'
    where c.created_at >= now() - interval '365 days'
      and c.ended_reason is distinct from 'business_left'
  )
  select vendor_id, round(extract(epoch from percentile_cont(0.5) within group (order by first_reply - first_ask)) / 60)::int
  from convs
  where first_ask is not null and first_reply > first_ask
  group by vendor_id
  having count(*) >= 3
$$;

revoke all on function published_reply_times(), tags_are_tidy(text[]) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function published_reply_times(), tags_are_tidy(text[]) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function published_reply_times() to app_server;
grant execute on function tags_are_tidy(text[]) to app_server;
