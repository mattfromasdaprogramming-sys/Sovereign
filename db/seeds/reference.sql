-- Reference content that is new in the shared world: goods and sectors.
-- Laws and unit types are NOT seeded here: they must be transcribed from the
-- existing game data so balance stays identical.

insert into goods (code, name, category, unit, is_strategic, base_price) values
  ('grain',        'Grain',            'raw',          'tonne', false, 1200),
  ('livestock',    'Livestock',        'raw',          'head',  false, 2600),
  ('timber',       'Timber',           'raw',          'm3',    false, 1500),
  ('iron_ore',     'Iron Ore',         'raw',          'tonne', false, 2200),
  ('coal',         'Coal',             'raw',          'tonne', false, 1700),
  ('oil',          'Crude Oil',        'raw',          'barrel', true, 3100),
  ('steel',        'Steel',            'intermediate', 'tonne', true,  4800),
  ('fuel',         'Refined Fuel',     'intermediate', 'barrel', true, 5200),
  ('machinery',    'Machinery',        'intermediate', 'unit',  false, 12000),
  ('electronics',  'Electronics',      'intermediate', 'unit',  false, 15000),
  ('textiles',     'Textiles',         'consumer',     'bale',  false, 3400),
  ('food',         'Processed Food',   'consumer',     'tonne', false, 2900),
  ('medicine',     'Medicine',         'consumer',     'crate', false, 7600),
  ('ammunition',   'Ammunition',       'military',     'crate', true,  6400),
  ('vehicles',     'Vehicles',         'military',     'unit',  false, 22000)
on conflict (code) do nothing;

insert into sectors (code, name, inputs, outputs, labour_per_unit, capital_per_unit, needs_licence) values
  ('agriculture',   'Agriculture',
    '{}', '{"grain": 10, "livestock": 3}', 1.0, 1800, true),
  ('mining',        'Mining',
    '{}', '{"iron_ore": 8, "coal": 6, "oil": 2}', 1.2, 2600, true),
  ('energy',        'Energy',
    '{"oil": 2}', '{"fuel": 6}', 1.1, 3200, true),
  ('manufacturing', 'Manufacturing',
    '{"steel": 4, "electronics": 1}', '{"machinery": 2, "vehicles": 1}', 1.6, 4200, true),
  ('construction',  'Construction',
    '{"timber": 4, "steel": 3}', '{}', 1.4, 2000, true),
  ('transport',     'Transport',
    '{"fuel": 2}', '{}', 1.3, 2400, true),
  ('finance',       'Finance',
    '{}', '{}', 0.8, 5000, true),
  ('media',         'Media',
    '{}', '{}', 0.9, 1600, true),
  ('arms',          'Arms Industry',
    '{"steel": 3, "ammunition": 2}', '{"vehicles": 1}', 1.8, 5600, true)
on conflict (code) do nothing;
