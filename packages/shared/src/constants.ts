/**
 * Tunable constants of the real-time protocol. The wire protocol's limits and
 * cadences live here so both server and client compile against one truth.
 *
 * The server carries injectable overrides for these (see `ServerConfig`) so
 * integration tests can scale the clock down while keeping real timers.
 */
export const PROTOCOL = {
  /** Board size, row-major, always 16 entries. */
  BOARD_SIZE: 16,

  /* ---------- capacity ---------- */
  /** Maximum connected players per room (spectators not counted). */
  MAX_PLAYERS: 8,
  /** Maximum rooms this process hosts at once. */
  MAX_ROOMS: 32,

  /* ---------- clock ---------- */
  /** Length of one playing round, in ms. */
  ROUND_MS: 120_000,
  /** Length of one intermission between rounds, in ms. */
  INTERMISSION_MS: 20_000,
  /** Cadence of the tick re-anchoring message, in ms. */
  TICK_INTERVAL_MS: 1_000,

  /* ---------- inactivity ---------- */
  /** How long a room with zero connected occupants survives, in ms. */
  ROOM_EMPTY_GRACE_MS: 60_000,
  /** How long a room survives without any activity, in ms. */
  ROOM_IDLE_MS: 30 * 60_000,

  /* ---------- hardening ---------- */
  /** Maximum inbound message size per frame, in bytes. */
  MAX_PAYLOAD_BYTES: 4 * 1024,
  /** Hard transport cap protecting the process from giant frames. */
  MAX_PAYLOAD_HARD_BYTES: 64 * 1024,
  /** Sliding quota window size, in ms. */
  QUOTA_WINDOW_MS: 10_000,
  /** Messages allowed per quota window. */
  QUOTA_MAX_MESSAGES: 40,
  /** Interval between WebSocket-level pings, in ms. */
  PING_INTERVAL_MS: 15_000,
  /** A connection is torn down after this long without a pong, in ms. */
  PONG_GRACE_MS: 45_000,

  /* ---------- room codes ---------- */
  /** Length of a newly minted room code. */
  ROOM_CODE_LENGTH: 5,
  /** Alphabet for room codes: ambiguity-free (no 0/O/1/I/l). */
  ROOM_CODE_ALPHABET: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
} as const;
