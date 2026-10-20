/**
 * The closed set of typed error codes. `message` is optional server detail;
 * German strings are rendered client-side. A stale/invalid session token is
 * never an error grade — it silently degrades to new-player semantics.
 */
export type ErrorCode =
  | "room-not-found"
  | "room-full"
  | "nickname-taken"
  | "token-invalid"
  | "invalid-word"
  | "word-duplicate"
  | "round-over"
  | "not-host"
  | "rate-limited"
  | "server-full"
  | "invalid-message"
  | "not-playing"
  | "invalid-phase";

export interface ErrorEnvelope {
  reqId?: number;
  code: ErrorCode;
  message?: string;
}
