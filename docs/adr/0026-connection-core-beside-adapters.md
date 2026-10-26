# ADR-0026: One connection core beside two thin adapters

- Status: Accepted
- Date: 2026-10-26
- Ticket: [#165](https://github.com/thom404/wortschatz/issues/165) (deepening)
- Related: [ADR-0014](0014-connection-seam-and-field-validation.md) (the
  greeting and Close outcome), [ADR-0015](0015-architecture-review-one-home-per-rule.md)
  (one home per rule)

## Context

The app-facing connection surface existed three times: declared in the app
module, implemented by the WebSocket adapter and implemented again by the
scripted test adapter. The scripted copy repeated the Snapshot side effects —
saving the Session token and flipping the status to `open` — and the end-frame
handling that produces a Close outcome. Nothing kept it in step with
production, and no client test exercised the production message-handling path,
so the suite could stay green while the two diverged. Greeting, reqId
allocation, send gating and `request`/`resync` were duplicated as well, and the
factory and both adapters carried an unused room-code field.

A future change to session persistence, status order or close outcomes would
have had to be made twice, and the copy players never see was the one under
test. The connection had no single owner.

## Decision

1. **One port in one neutral module.** `packages/client/src/connection.ts`
   declares `RoomConn`, `ConnFactory`, `ConnStatus`, `CloseOutcome`, `GreetFn`,
   `ServerListener`, the stored-session types and the session storage helpers.
   The app declares no duplicate surface. Both the WebSocket adapter and the
   scripted test adapter declare `implements RoomConn`, so typecheck fails if a
   copy loses or renames a method.
2. **One transport-agnostic core.** `ConnectionCore` in the same module owns
   one `start()` per connection, the `connecting` status, the Greeting with the
   first reqId, monotonic reqId allocation, the writable flag (transport up and
   not finished), the finished flag, `send` gating, `request`/`resync`, the
   Snapshot side effects, Close outcome derivation and the retry-attempt count.
   It imports no WebSocket, no `location` and no DOM.
3. **Transport I/O stays with the adapters.** Each adapter supplies exactly
   three operations — open the transport, write a typed frame, close the
   transport — and reports transport up, a parsed server frame and transport
   closed with an orderly flag. The core never sees a socket, a close code or a
   timer.
4. **The status and outcome rules are unchanged.** `connecting` on start,
   `open` on every Snapshot, `retrying` after an unexpected transport close and
   no `closed` status. An end frame reaches the listener before exactly one
   Close outcome; a later frame is ignored. An orderly transport close with no
   end frame yields one `connection-lost`; an unexpected close yields
   `retrying` and no outcome. `stop()` is silent.
5. **Retry responsibility is split.** The core owns the attempt count and
   resets it on every Snapshot. The WebSocket adapter owns the timer and the
   capped exponential delay (0.5 s → 30 s), reads the attempt index the core
   returns, and asks the core to reconnect. The scripted adapter has no timer.
6. **Session storage moves with the seam.** The `wordament:session:` namespace,
   the lowercase room-code key and the use of the Snapshot's `room.code` rather
   than the greeting code stay exactly as they were. The helpers live in the
   connection module; the scripted adapter no longer imports or reproduces
   their logic.
7. **The scripted adapter keeps its test surface.** It composes the core,
   implements the port and keeps `feed`, `retry`, `abruptClose`, `sent`,
   `sentTypes`, `outbox`, `statuses`, `closeOutcomes` and `stopped` with their
   current meaning. `retry()` reports the unexpected-close branch, so the
   existing status-notice test proves the shared classification;
   `abruptClose()` remains the orderly-close branch.
8. **The WebSocket adapter is renamed and reduced to glue.** The old
   `api.ts` becomes `websocket.ts`; it owns `RoomConnection`, socket creation,
   frame parsing, close-code mapping, backoff and the retry timer, and is the
   only client module that touches `WebSocket` or `location`. The dead `code`
   field disappears from the factory options and both adapters.
9. **App wiring only.** The app imports the port and factory from the
   connection module, keeps `mount(root, factory)` and the `ConnFactory`
   injection point, and passes only greet, listener, status and close options.
   Production boot constructs the WebSocket adapter. No screen, store, view
   state or notification logic changes.

## Consequences

- The Snapshot save and status flip have one home, the Greeting and reqId rules
  have one home, and kicked, room-ended and connection-lost cannot diverge
  between adapters.
- The mount suite now drives the production message-handling path through the
  scripted adapter, while a direct unit seam on `ConnectionCore` asserts
  Snapshot persistence, close ordering and retry-count reset without mounting
  the app.
- The compiler is the third check: both adapters implement the one port.
- No wire frame, screenshot, German copy, skin or scoring behaviour changes.
  Close-code mapping and backoff timing remain untested, as before; the
  WebSocket adapter is now thin enough that a fake socket or timer seam is not
  needed.

## Suppressed alternatives

- **One transport-injected class instead of a core plus adapters.** Rejected:
  it would still make the production class own sockets, timers and protocol at
  once, so tests would have to fake a socket or a scheduler to reach the shared
  rules.
- **Share only a message handler while each adapter keeps its own status,
  send and close logic.** Rejected: the Snapshot side effects, send gating and
  Close outcome would still have two homes, which is the drift this change
  removes.
- **Move retry timing into the core.** Rejected: it would force fake timers in
  tests; the adapter already owns the socket lifecycle.
