# ADR-0014: One greeting and one close outcome at the client seam

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#123](https://github.com/thom404/wortschatz/issues/123), part of
  [#117](https://github.com/thom404/wortschatz/issues/117) (architecture review)

## Context

The client connection seam had two greeting types: `app.ts` built a
`ClientMessage | null` greeting, while `api.ts` declared a `GreetFn` that took
the connection itself, and production wrapped one in the other. The same seam
also reported an orderly end twice: `RoomConnection` first pushed a `closed`
status and then delivered the `kicked` / `room-ended` frame. The app had to
suppress the generic connection-lost screen on the status and let the later
frame win, so correctness depended on callback order.

Server-side shape validation was one large `switch` that repeated the same
error envelope at every failure point. Adding a message or a field meant
editing several copies of that shape.

## Decision

1. **One greeting type.** `GreetingMsg` in the shared wire contract is exactly
   `create-room | join`. `GreetFn` is declared once at the client seam as
   `() => GreetingMsg | null`; the app and `RoomConnection` both use it. No
   wire message changes shape.
2. **One close outcome.** The connection derives a `CloseOutcome` from the
   server's end frame or from an orderly transport close that carried no
   frame: `kicked`, `room-ended` with its reason, or `connection-lost`. It
   delivers the end frame to the listener first, then emits exactly one
   outcome. Status is only `connecting`, `open` or `retrying`; there is no
   separate closed status to race the frame.
3. **Validation is a field specification.** `Connection` keeps a table of
   every client message and the fields it carries (`string` / `integer`,
   required or optional, non-empty). One reader walks the table and produces
   the typed message; required-field failures reject with the field's detail.
4. **One error reply builder.** `errorReply(code, message, reqId?)` is the
   only place the validation error envelope is constructed: `type: "error"`,
   the echoed `reqId` when present, the code and the detail. The reply keeps
   its existing shape.

## Consequences

- The app no longer inspects `store.outcome` or the status order to choose
  between an end screen and a connection-lost screen; the close outcome is
  the single trigger.
- Greeting and close handling each have one type, so the production adapter
  and the test harness implement the same surface.
- Adding a message field is one row in the specification table; the wire
  shape of existing messages is unchanged.
- Field validation is still exercised at the highest server seam: the real
  WebSocket wire through the test client.

## Suppressed alternatives

- **Keep the closed status and rely on the frame arriving after it.**
  Rejected: that is the callback-order dependency this change removes.
- **Let `RoomConnection` swallow end frames and report only an outcome.**
  Rejected: the store still needs the authoritative frame to apply its state;
  the connection delivers it before the one outcome.
- **Validate each message with a bespoke switch branch.** Rejected: it keeps
  the error envelope and field rules duplicated across branches.
