import { runTick } from '../src/tick.js';
import { pool } from '../src/db.js';

// Force one tick, even when the clock says it is not due yet.
try {
  const result = await runTick({ force: true });

  if (result.skipped) {
    console.log(`Tick skipped: ${result.skipped}`);
  } else {
    console.log(`Tick ${result.tick} done in ${result.duration_ms} ms`);
    for (const [phase, value] of Object.entries(result.phases)) {
      console.log(`  ${phase}: ${JSON.stringify(value)}`);
    }
  }
} finally {
  await pool.end();
}
