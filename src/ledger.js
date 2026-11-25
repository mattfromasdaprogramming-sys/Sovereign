/**
 * The only way money moves. Callers pass signed entries that sum to zero; the
 * database re-checks the sum at commit with a deferred constraint trigger, so an
 * unbalanced transaction can never be committed even if this check is bypassed.
 */
export async function postTxn(client, {
  reason,
  entries,
  memo = null,
  actorPlayerId = null,
  nationId = null,
  companyId = null,
  muId = null,
  cityId = null,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('a ledger transaction needs at least one entry');
  }

  const total = entries.reduce((sum, e) => sum + BigInt(e.amount), 0n);
  if (total !== 0n) {
    throw new Error(`unbalanced ledger transaction: entries sum to ${total}`);
  }

  const { rows: [ws] } = await client.query('select current_tick from world_state where id');
  const tick = ws.current_tick;

  const { rows: [txn] } = await client.query(
    `insert into ledger_txns (tick, reason, actor_player_id, nation_id, company_id, mu_id, city_id, memo)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [tick, reason, actorPlayerId, nationId, companyId, muId, cityId, memo],
  );

  for (const entry of entries) {
    await client.query(
      `insert into ledger_entries
         (txn_id, tick, account_id, amount, reason, nation_id, company_id, player_id, ref_type, ref_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        txn.id,
        tick,
        entry.accountId,
        entry.amount,
        reason,
        entry.nationId ?? nationId,
        entry.companyId ?? companyId,
        entry.playerId ?? null,
        entry.refType ?? null,
        entry.refId ?? null,
      ],
    );
  }

  return txn.id;
}

/** The single negative-capable account. Created on first use, then reused. */
export async function getIssuanceAccount(client) {
  const { rows } = await client.query(`select id from accounts where kind = 'world_issuance'`);
  if (rows[0]) return rows[0].id;

  try {
    const { rows: [created] } = await client.query(
      `insert into accounts (kind, allow_overdraft) values ('world_issuance', true) returning id`,
    );
    return created.id;
  } catch (err) {
    if (err.code === '23505') {
      const { rows: [again] } = await client.query(`select id from accounts where kind = 'world_issuance'`);
      return again.id;
    }
    throw err;
  }
}
