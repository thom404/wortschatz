import { describe, expect, it } from "vitest";
import {
  applyGestureSample,
  type GestureOutcome,
  type GesturePhase,
  type GestureSample,
  type GestureState,
  type GestureStream,
  type PointerKind,
} from "../src/gesture.js";

/**
 * The pure Gesture rules (#120), driven from plain sample sequences — no
 * DOM, no geometry stub. Tile indices are row-major on a 4×4 board; the
 * samples need no board letters, only the shape of the trace.
 */

/** One normalized sample; `clear` defaults to a clear hit and the stream's
 *  id to a fixed value, so a sequence reads as positions alone. */
function sample(
  phase: GesturePhase,
  stream: GestureStream,
  tile: number,
  opts: { id?: number; clear?: boolean; pointerType?: PointerKind } = {}
): GestureSample {
  return {
    phase,
    stream,
    id: opts.id ?? (stream === "pointer" ? 1 : 7),
    point: { x: 0, y: 0 },
    tile,
    clear: opts.clear ?? true,
    ...(opts.pointerType ? { pointerType: opts.pointerType } : {}),
  };
}

/** Folds a sample sequence through the reducer and records every decision. */
function run(samples: GestureSample[]): {
  state: GestureState | null;
  outcomes: GestureOutcome[];
  submits: number[][];
} {
  let state: GestureState | null = null;
  const outcomes: GestureOutcome[] = [];
  const submits: number[][] = [];
  for (const s of samples) {
    const outcome = applyGestureSample(state, s);
    outcomes.push(outcome);
    if (outcome.submit) submits.push(outcome.submit);
    state = outcome.state;
  }
  return { state, outcomes, submits };
}

/** The tiles of the live gesture, or an empty trace once it ended. */
function trace(state: GestureState | null): number[] {
  return state?.trace ?? [];
}

describe("pure Gesture rules (#120)", () => {
  it("builds exactly one trace across one gesture's two event streams", () => {
    // A touch pointer begins the drag; the same finger's touch stream joins;
    // movement then arrives over both streams and both report the release.
    const { state, submits } = run([
      sample("down", "pointer", 0, { pointerType: "touch" }),
      sample("down", "touch", 0),
      sample("move", "pointer", 1, { pointerType: "touch" }),
      sample("move", "touch", 4),
      sample("up", "pointer", 4, { pointerType: "touch" }),
      sample("up", "touch", 4), // the second release finds no live gesture
    ]);
    expect(submits).toEqual([[0, 1, 4]]);
    expect(state).toBeNull();
  });

  it("ignores movement after a gesture has released", () => {
    const { state, submits } = run([
      sample("down", "pointer", 0),
      sample("move", "pointer", 1),
      sample("up", "pointer", 1),
      sample("move", "pointer", 4), // a stray move after release
    ]);
    expect(submits).toEqual([[0, 1]]);
    expect(state).toBeNull();
  });

  it("keeps a touch gesture alive through a touch pointer's cancel", () => {
    const { state, submits } = run([
      sample("down", "pointer", 0, { pointerType: "touch" }),
      sample("down", "touch", 0),
      sample("move", "pointer", 1, { pointerType: "touch" }),
      sample("cancel", "pointer", 1, { pointerType: "touch" }),
      sample("move", "touch", 4), // the touch stream still carries the finger
      sample("up", "touch", 4),
    ]);
    expect(submits).toEqual([[0, 1, 4]]);
    expect(state).toBeNull();
  });

  it("ends a mouse pointer's cancel and a touchcancel without submitting", () => {
    const mouse = run([
      sample("down", "pointer", 0, { pointerType: "mouse" }),
      sample("move", "pointer", 1, { pointerType: "mouse" }),
      sample("cancel", "pointer", 1, { pointerType: "mouse" }),
    ]);
    expect(mouse.submits).toEqual([]);
    expect(mouse.state).toBeNull();

    const touch = run([sample("down", "touch", 0), sample("move", "touch", 1), sample("cancel", "touch", 1)]);
    expect(touch.submits).toEqual([]);
    expect(touch.state).toBeNull();
  });

  it("bridges the tiles a sparse sample skipped (stair-step)", () => {
    // Same row, one tile skipped.
    expect(trace(run([sample("down", "pointer", 0), sample("move", "pointer", 2)]).state)).toEqual([0, 1, 2]);
    // Diagonal across the board.
    expect(trace(run([sample("down", "pointer", 0), sample("move", "pointer", 10)]).state)).toEqual([
      0, 5, 10,
    ]);
    // Diagonal until the row matches, then straight down.
    expect(trace(run([sample("down", "pointer", 0), sample("move", "pointer", 13)]).state)).toEqual([
      0, 5, 9, 13,
    ]);
  });

  it("unwinds the most recent tile on backtracking", () => {
    const { state, submits } = run([
      sample("down", "pointer", 0),
      sample("move", "pointer", 1),
      sample("move", "pointer", 0), // back onto the previous tile
      sample("up", "pointer", 0),
    ]);
    expect(submits).toEqual([[0]]);
    expect(state).toBeNull();
  });

  it("uses a tile at most once per word", () => {
    // A jump back over an already-used tile is rejected, bridge and all.
    const bridged = run([
      sample("down", "pointer", 0),
      sample("move", "pointer", 1),
      sample("move", "pointer", 2),
      sample("move", "pointer", 0),
    ]);
    expect(trace(bridged.state)).toEqual([0, 1, 2]);

    // A single adjacent step onto a used tile is rejected too.
    const adjacent = run([
      sample("down", "pointer", 0),
      sample("move", "pointer", 1),
      sample("move", "pointer", 5),
      sample("move", "pointer", 0),
    ]);
    expect(trace(adjacent.state)).toEqual([0, 1, 5]);
  });

  it("moves the trace only for a sample clearly inside the target tile", () => {
    // An unclear near-miss on a neighbour selects nothing.
    expect(
      trace(run([sample("down", "pointer", 0), sample("move", "pointer", 1, { clear: false })]).state)
    ).toEqual([0]);

    // An unclear sample on the previous tile does not unwind it.
    expect(
      trace(
        run([
          sample("down", "pointer", 0),
          sample("move", "pointer", 5),
          sample("move", "pointer", 0, { clear: false }),
        ]).state
      )
    ).toEqual([0, 5]);

    // A clear sample on the previous tile unwinds it.
    expect(
      trace(
        run([sample("down", "pointer", 0), sample("move", "pointer", 5), sample("move", "pointer", 0)]).state
      )
    ).toEqual([0]);
  });

  it("opens the gesture leniently, ignoring the clear flag on the press", () => {
    // The opening press is within the gap margin; it still selects the tile.
    expect(trace(run([sample("down", "pointer", 0, { clear: false })]).state)).toEqual([0]);
  });

  it("opens no gesture for a press that hits no tile", () => {
    const { state, outcomes } = run([sample("down", "pointer", -1)]);
    expect(state).toBeNull();
    expect(outcomes[0]).toMatchObject({ traceChanged: false, claimed: false });
  });

  it("does not add the current tile twice", () => {
    expect(trace(run([sample("down", "pointer", 0), sample("move", "pointer", 0)]).state)).toEqual([0]);
  });

  it("ignores movement from a stream that has not joined the gesture", () => {
    // The gesture is touch-only; a stray pointer move must not move it.
    const { state } = run([
      sample("down", "touch", 0),
      sample("move", "pointer", 1, { id: 3, pointerType: "mouse" }),
    ]);
    expect(trace(state)).toEqual([0]);
  });
});
