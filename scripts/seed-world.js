import { readFile } from 'node:fs/promises';

/**
 * Seed nations and cities from data/world.json.
 *
 * That file is produced from the existing world data (worlddata.js / geoextra.js)
 * by scripts/import-legacy.js once the game files land. Shape:
 *
 * {
 *   "nations": [{ "id": 1, "iso2": "FR", "iso3": "FRA", "name": "France",
 *                 "capital": "Paris", "flag": "🇫🇷", "region": "Europe",
 *                 "government_type": "republic", "population": 68000000 }],
 *   "cities":  [{ "nation_id": 1, "name": "Paris", "is_capital": true,
 *                 "population": 2100000, "tier": 1, "base_revenue": 500000 }]
 * }
 *
 * `base_revenue` is in minor units (1 credit = 100). Idempotent: re-running
 * updates nation facts and leaves existing accounts and cities alone.
 */
export async function seedWorld(client, worldFile) {
  const data = JSON.parse(await readFile(worldFile, 'utf8'));
  const nations = data.nations ?? [];
  const cities = data.cities ?? [];

  let nationCount = 0;
  let cityCount = 0;

  for (const n of nations) {
    await client.query(
      `insert into nations (id, iso2, iso3, name, capital, flag_emoji, region, government_type, population)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update
          set name            = excluded.name,
              capital         = excluded.capital,
              flag_emoji      = excluded.flag_emoji,
              region          = excluded.region,
              government_type = excluded.government_type,
              population      = excluded.population`,
      [
        n.id,
        n.iso2,
        n.iso3 ?? null,
        n.name,
        n.capital,
        n.flag ?? '',
        n.region ?? null,
        n.government_type ?? 'republic',
        n.population ?? 0,
      ],
    );
    nationCount += 1;

    const { rows: [existing] } = await client.query(
      `select id from accounts where kind = 'treasury' and nation_id = $1`,
      [n.id],
    );

    const treasuryId =
      existing?.id ??
      (await client.query(
        `insert into accounts (kind, nation_id) values ('treasury', $1) returning id`,
        [n.id],
      )).rows[0].id;

    await client.query(
      `update nations set treasury_account_id = $1
        where id = $2 and treasury_account_id is distinct from $1`,
      [treasuryId, n.id],
    );
  }

  for (const c of cities) {
    const { rows: [city] } = await client.query(
      `insert into cities (nation_id, name, is_capital, population, tier, base_revenue)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (nation_id, name) do update
          set population   = excluded.population,
              tier         = excluded.tier,
              base_revenue = excluded.base_revenue
       returning id`,
      [
        c.nation_id,
        c.name,
        Boolean(c.is_capital),
        c.population ?? 0,
        c.tier ?? 1,
        BigInt(c.base_revenue ?? 0).toString(),
      ],
    );

    const { rows: [existing] } = await client.query(
      `select id from accounts where kind = 'city' and city_id = $1`,
      [city.id],
    );

    if (!existing) {
      const { rows: [account] } = await client.query(
        `insert into accounts (kind, city_id) values ('city', $1) returning id`,
        [city.id],
      );
      await client.query(`update cities set revenue_account_id = $1 where id = $2`, [
        account.id,
        city.id,
      ]);
    }

    cityCount += 1;
  }

  return { nations: nationCount, cities: cityCount };
}
