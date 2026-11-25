import { q } from './db.js';

export async function getWallet(playerId) {
  const { rows: [account] } = await q(
    `select id, balance, is_frozen, updated_tick, updated_at
       from accounts where kind = 'personal' and player_id = $1`,
    [playerId],
  );

  if (!account) return null;

  const { rows: entries } = await q(
    `select e.id, e.amount, e.reason, e.tick, e.created_at, e.txn_id
       from ledger_entries e
      where e.account_id = $1
      order by e.id desc
      limit 50`,
    [account.id],
  );

  return { account, entries };
}
