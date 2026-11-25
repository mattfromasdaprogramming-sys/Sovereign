import os from 'node:os';
import { pool } from './db.js';

/** Advisory-lock key: one tick runner at a time, process-wide and machine-wide. */
const LOCK_KEY = 'world_tick';

/**
 * Phase 1 of the real tick order. Every phase writes keyed rows (tick in the
 * primary key) so a crashed run can be resumed instead of replayed.
 */
export async function reconcileLedger(client, tick) {
  const { rows: [row] } = await client.query(`
    select (select coalesce(sum(balance), 0) from accounts)      as total_balances,
           (select coalesce(sum(amount),  0) from ledger_entries) as total_entries
  `);

  const balances = BigInt(row.total_balances);
  const entries = BigInt(row.total_entries);
  const delta = balances - entries;

  await client.query(
    `insert into ledger_checkpoints (tick, total_balances, total_entries, is_balanced, delta)
     values ($1, $2, $3, $4, $5)
     on conflict (tick) do update
        set total_balances = excluded.total_balances,
            total_entries  = excluded.total_entries,
            is_balanced    = excluded.is_balanced,
            delta          = excluded.delta,
            checked_at     = now()`,
    [tick, balances.toString(), entries.toString(), delta === 0n, delta.toString()],
  );

  return {
    total_balances: balances.toString(),
    total_entries: entries.toString(),
    delta: delta.toString(),
    balanced: delta === 0n,
  };
}

/**
 * Ordered phases. The full order from the design doc goes here as the game
 * layers land; `reconcile` is last today and stays last.
 */
const PHASES = [['reconcile', reconcileLedger]];

/**
 * Advance the world exactly one tick.
 * Returns { skipped } when the tick is not due, paused, or owned by another process.
 */
export async function runTick({ force = false } = {}) {
  const startedAt = Date.now();
  const client = await pool.connect();
  let number = null;

  try {
    await client.query('begin');

    const { rows: [lock] } = await client.query(
      'select pg_try_advisory_xact_lock(hashtext($1)) as ok',
      [LOCK_KEY],
    );
    if (!lock.ok) {
      await client.query('rollback');
      return { skipped: 'locked' };
    }

    const { rows: [world] } = await client.query('select * from world_state where id for update');

    if (world.is_paused && !force) {
      await client.query('rollback');
      return { skipped: 'paused' };
    }

    if (!force && world.next_tick_at && new Date(world.next_tick_at).getTime() > Date.now()) {
      await client.query('rollback');
      return { skipped: 'not_due', next_tick_at: world.next_tick_at };
    }

    number = Number(world.current_tick) + 1;

    try {
      await client.query(
        'insert into ticks (number, revision_start, locked_by) values ($1, $2, $3)',
        [number, world.revision, `${process.pid}@${os.hostname()}`],
      );
    } catch (err) {
      if (err.code === '23505') {
        await client.query('rollback');
        return { skipped: 'already_ticked', tick: number };
      }
      throw err;
    }

    const phaseResults = {};

    for (const [phase, run] of PHASES) {
      await client.query('insert into tick_phases (tick, phase) values ($1, $2)', [number, phase]);

      try {
        phaseResults[phase] = await run(client, number);
        await client.query(
          `update tick_phases set status = 'succeeded', finished_at = now()
            where tick = $1 and phase = $2`,
          [number, phase],
        );
      } catch (err) {
        await client.query(
          `update tick_phases set status = 'failed', finished_at = now(), error = $3
            where tick = $1 and phase = $2`,
          [number, phase, String(err.message)],
        );
        throw err;
      }
    }

    const { rows: [rev] } = await client.query(`select nextval('world_revision_seq') as rev`);
    const duration = Date.now() - startedAt;

    await client.query(
      `insert into change_log (rev, tick, entity_type, entity_id, change)
       values ($1, $2, 'world', $2, 'tick')`,
      [rev.rev, number],
    );

    await client.query(
      `update world_state
          set current_tick          = $1,
              next_tick_at          = coalesce(next_tick_at, now()) + make_interval(mins => $2),
              last_tick_duration_ms = $3,
              revision              = greatest(revision, $4)
        where id`,
      [number, world.interval_minutes, duration, rev.rev],
    );

    await client.query(
      `update ticks
          set status = 'succeeded', finished_at = now(), duration_ms = $2, revision_end = $3
        where number = $1`,
      [number, duration, rev.rev],
    );

    await client.query('commit');
    return { tick: number, duration_ms: duration, phases: phaseResults };
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* connection already broken */
    }

    if (number !== null) {
      try {
        await pool.query(
          'insert into tick_errors (tick, phase, message) values ($1, $2, $3)',
          [number, 'tick', String(err.message)],
        );
      } catch {
        /* best effort */
      }
    }

    throw err;
  } finally {
    client.release();
  }
}

/** Catch-up safe: runs every tick that is already due, up to `max`. */
export async function runDueTicks({ max = 4 } = {}) {
  const results = [];

  for (let i = 0; i < max; i += 1) {
    const result = await runTick();
    results.push(result);
    if (result.skipped) break;
  }

  return results;
}
