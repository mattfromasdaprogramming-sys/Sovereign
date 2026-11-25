import { pool, q } from '../src/db.js';

// Money conservation: accounts and the ledger must agree, and the only account
// allowed below zero is world_issuance.
const { rows: [row] } = await q(`
  select (select coalesce(sum(balance), 0) from accounts)      as total_balances,
         (select coalesce(sum(amount),  0) from ledger_entries) as total_entries
`);

const balances = BigInt(row.total_balances);
const entries = BigInt(row.total_entries);
const delta = balances - entries;

console.log(`accounts total : ${balances}`);
console.log(`ledger total   : ${entries}`);
console.log(`delta          : ${delta}`);

const { rows: negative } = await q(
  `select id, kind, balance from accounts where balance < 0 order by balance`,
);

if (negative.length > 0) {
  console.log('\nnegative balances:');
  for (const a of negative) console.log(`  #${a.id} ${a.kind}: ${a.balance}`);
}

const ok = delta === 0n && negative.every((a) => a.kind === 'world_issuance');
console.log(ok ? '\nledger is balanced.' : '\nLEDGER IS NOT BALANCED.');

await pool.end();
process.exit(ok ? 0 : 1);
