import { runDueTicks } from '../src/tick.js';
import { pool } from '../src/db.js';

const pollMs = Number(process.env.TICK_POLL_MS ?? 15_000);
const maxCatchup = Number(process.env.MAX_CATCHUP_TICKS ?? 4);
let busy = false;

async function loop() {
  if (busy) return;
  busy = true;

  try {
    const results = await runDueTicks({ max: maxCatchup });
    const ran = results.filter((r) => !r.skipped);

    for (const tick of ran) {
      console.log(`[tick] ${tick.tick} in ${tick.duration_ms} ms`);
    }

    const last = results.at(-1);
    if (last?.skipped === 'locked') console.log('[tick] another worker holds the lock, waiting.');
    if (last?.skipped === 'not_due') console.log('[tick] not due yet.');
  } catch (err) {
    console.error('[tick] failed:', err.message);
  } finally {
    busy = false;
  }
}

console.log(`Tick worker started (poll ${pollMs} ms, max catch-up ${maxCatchup}).`);
await loop();
const timer = setInterval(loop, pollMs);

const stop = async () => {
  clearInterval(timer);
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
