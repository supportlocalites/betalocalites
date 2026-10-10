-- =============================================================================
-- Localites — migration 0002: launch area and categories (reference data)
-- =============================================================================
-- Launch area: D-09 (Orillia, Severn, Oro-Medonte, Ramara).
-- Categories: PO-05, with the groupings recorded in docs/H-product-owner-action-register.md.
-- Both are data, not code: admins can add, rename or retire them later.
-- Town centre points are left empty until taken from an authoritative source;
-- they are never guessed (see the municipality table).
-- =============================================================================

set search_path = public, extensions;

insert into municipality (slug, name, region, is_active, sort_order) values
  ('orillia',     'Orillia',     'Simcoe County', true, 1),
  ('severn',      'Severn',      'Simcoe County', true, 2),
  ('oro-medonte', 'Oro-Medonte', 'Simcoe County', true, 3),
  ('ramara',      'Ramara',      'Simcoe County', true, 4);

insert into category (slug, name, sort_order) values
  ('venue',             'Venue',             1),
  ('food-and-beverage', 'Food & Beverage',   2),
  ('sweets',            'Sweets',            3),
  ('rentals-and-decor', 'Rentals & Decor',   4),
  ('activities',        'Activities',        5),
  ('photography',       'Photography',       6);

insert into category (parent_id, slug, name, sort_order)
select p.id, c.slug, c.name, c.sort_order
from (values
  ('venue', 'party-rooms',           'Party rooms',                1),
  ('venue', 'halls',                 'Halls',                      2),
  ('venue', 'indoor-play',           'Indoor play',                3),
  ('venue', 'activity-centres',      'Bowling and activity centres', 4),
  ('venue', 'event-spaces',          'Event spaces',               5),
  ('food-and-beverage', 'caterers',    'Caterers',     1),
  ('food-and-beverage', 'food-trucks', 'Food trucks',  2),
  ('food-and-beverage', 'party-trays', 'Party trays',  3),
  ('food-and-beverage', 'mobile-bars', 'Mobile bars',  4),
  ('sweets', 'custom-cakes',  'Custom cakes',   1),
  ('sweets', 'cupcakes',      'Cupcakes',       2),
  ('sweets', 'cookies',       'Cookies',        3),
  ('sweets', 'chocolates',    'Chocolates',     4),
  ('sweets', 'dessert-tables','Dessert tables', 5),
  ('sweets', 'ice-cream',     'Ice cream',      6),
  ('rentals-and-decor', 'tents-tables-chairs', 'Tents, tables and chairs', 1),
  ('rentals-and-decor', 'bouncy-castles',      'Bouncy castles',           2),
  ('rentals-and-decor', 'balloons',            'Balloons',                 3),
  ('rentals-and-decor', 'decor',               'Decor',                    4),
  ('rentals-and-decor', 'photo-booths',        'Photo booths',             5),
  ('activities', 'face-painting',    'Face painting',    1),
  ('activities', 'magicians',        'Magicians',        2),
  ('activities', 'balloon-twisting', 'Balloon twisting', 3),
  ('activities', 'characters',       'Character parties', 4),
  ('activities', 'djs-and-music',    'DJs and music',    5),
  ('activities', 'animal-shows',     'Animal shows',     6),
  ('activities', 'crafts',           'Crafts',           7),
  ('activities', 'science',          'Science',          8),
  ('activities', 'sports',           'Sports',           9),
  ('photography', 'photographers',  'Photographers',  1),
  ('photography', 'videographers',  'Videographers',  2)
) as c(parent_slug, slug, name, sort_order)
join category p on p.slug = c.parent_slug;
