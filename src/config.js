export const PORT = Number(process.env.PORT ?? 3000);

export const SESSION_COOKIE = 'sv_sid';
export const SESSION_TTL_DAYS = 30;

/** Credits are stored as whole minor units: 1 credit = 100 minor units. */
export const STARTING_CAPITAL_CREDITS = Number(process.env.STARTING_CAPITAL_CREDITS ?? 10_000);
export const STARTING_CAPITAL = Math.round(STARTING_CAPITAL_CREDITS * 100);

/** Per-player action allowance per tick (used once the action routes land). */
export const ACTIONS_PER_TICK = 40;

/**
 * 'invite' (default): registering needs a valid access code from `npm run invite`.
 * 'open': anyone can register, as in the full launch.
 */
export const SIGNUP_MODE =
  (process.env.SIGNUP_MODE ?? 'invite').toLowerCase() === 'open' ? 'open' : 'invite';

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
