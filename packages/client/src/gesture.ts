/**
 * The pure Gesture rules (#120): one continuous board drag from press to
 * release, independent of the event streams the browser reports it through.
 * This module owns only the rules; the client wiring owns event binding, the
 * point→tile hit-test and painting. Its input is a normalized sample — the
 * stream, the stream's identifier, the point, the resolved tile index and
 * whether the sample is clearly inside that tile. Its output is whether the
 * trace changed, whether the sample was claimed by a live gesture, and the
 * traced tiles a real release submits.
 *
 * Keeping the rules here lets a plain sequence of samples exercise them
 * without a DOM geometry stub. See [GLOSSARY](../../../GLOSSARY.md): Gesture.
 */

/** The two independent event streams a browser reports one finger through:
 *  the pointer stream and the touch stream. */
export type GestureStream = "pointer" | "touch";

/** The kind of a pointer-stream sample. A touch pointer's cancel defers to a
 *  joined touch stream; a mouse or pen cancel ends the gesture. */
export type PointerKind = "mouse" | "touch" | "pen";

/** What one sample reports. `down` opens or joins a gesture, `move` extends
 *  or unwinds it, `up` ends it with a submit, `cancel` ends it without one. */
export type GesturePhase = "down" | "move" | "up" | "cancel";

/**
 * One normalized drag sample. The wiring resolves the point to a tile
 * (`tile`, or -1 when it hits none) and decides whether the finger is clearly
 * inside it (`clear`); the rules below are geometry-free. A `down` is lenient
 * and ignores `clear` — the opening press always selects the resolved tile.
 */
export interface GestureSample {
  phase: GesturePhase;
  stream: GestureStream;
  /** The stream's identifier: a `pointerId`, or a touch's `identifier`. */
  id: number;
  /** The sample's position; carried for provenance — the rules read `tile`. */
  point: { x: number; y: number };
  /** The tile the point resolved to, or -1 when it hit no tile. */
  tile: number;
  /** Whether the point is clearly inside `tile` (the gap/edge margin). */
  clear: boolean;
  /** The pointer stream's kind; ignored for the touch stream. */
  pointerType?: PointerKind;
}

/**
 * The live gesture and whichever streams report it. A gesture begun by either
 * stream accepts movement from both — Android Firefox begins with
 * `pointerdown` but keeps sending `touchmove` — and whichever stream really
 * releases ends it, so the browser reporting the same finger twice still
 * submits exactly once. `null` between gestures.
 */
export interface GestureState {
  /** The pointer stream's id, once a pointer sample has joined; else null. */
  pointerId: number | null;
  /** A touch pointer's cancel dropped the pointer stream without ending the
   *  gesture; a later pointer sample is ignored. */
  pointerCancelled: boolean;
  /** The touch stream's id, once a touch sample has joined; else null. */
  touchId: number | null;
  /** The traced tile indices, oldest first. */
  trace: number[];
}

/** What the rules decided for one sample. */
export interface GestureOutcome {
  /** The live gesture after the sample, or `null` once it has ended. */
  state: GestureState | null;
  /** The visible trace changed; the wiring must repaint it. */
  traceChanged: boolean;
  /** The sample belongs to a live gesture; the wiring may claim the touch
   *  (preventDefault) so the page never scrolls or zooms under the finger. */
  claimed: boolean;
  /** The traced tiles a real release submits, or `null` for no submit. */
  submit: number[] | null;
}

/**
 * The reducer: folds one normalized sample into the gesture state. Returns
 * the next state plus what the wiring must do — repaint the trace, claim the
 * touch, and/or submit the traced tiles. Pass the returned `state` into the
 * next call, or `null` once it has ended.
 */
export function applyGestureSample(state: GestureState | null, sample: GestureSample): GestureOutcome {
  switch (sample.phase) {
    case "down":
      return onDown(state, sample);
    case "move":
      return onMove(state, sample);
    case "up":
      return onEnd(state, sample, true);
    case "cancel":
      return onCancel(state, sample);
  }
}

/** The press: opens a gesture on a tile, or joins the sample's stream to the
 *  live gesture. A press elsewhere changes nothing. */
function onDown(state: GestureState | null, sample: GestureSample): GestureOutcome {
  if (state === null) {
    if (sample.tile < 0) return ignored(null);
    return {
      state: {
        pointerId: sample.stream === "pointer" ? sample.id : null,
        pointerCancelled: false,
        touchId: sample.stream === "touch" ? sample.id : null,
        trace: [sample.tile],
      },
      traceChanged: true,
      claimed: true,
      submit: null,
    };
  }
  // The same gesture reported through a second stream after the first began
  // it: join the stream for movement and release dedupe rather than starting
  // a second gesture.
  if (sample.stream === "pointer") {
    if (!state.pointerCancelled && state.pointerId === null) {
      return claimed({ ...state, pointerId: sample.id });
    }
    return ignored(state);
  }
  if (state.touchId === null) return claimed({ ...state, touchId: sample.id });
  return ignored(state);
}

/** The movement: only the live gesture's own stream moves it. */
function onMove(state: GestureState | null, sample: GestureSample): GestureOutcome {
  if (state === null) return ignored(null);
  if (sample.stream === "pointer") {
    if (state.pointerCancelled || state.pointerId !== sample.id) return ignored(state);
  } else if (state.touchId !== sample.id) {
    return ignored(state);
  }
  return extend(state, sample);
}

/** The real release: submits the traced tiles. */
function onEnd(state: GestureState | null, sample: GestureSample, submit: boolean): GestureOutcome {
  if (state === null) return ignored(null);
  if (sample.stream === "pointer") {
    if (state.pointerCancelled || state.pointerId !== sample.id) return ignored(state);
  } else if (state.touchId !== sample.id) {
    return ignored(state);
  }
  return { state: null, traceChanged: true, claimed: true, submit: submit ? [...state.trace] : null };
}

/**
 * The cancel: a touch pointer's cancel is not the gesture's end while the
 * touch stream keeps delivering the same finger, so it only drops the pointer
 * stream; every other cancel ends the gesture without submitting.
 */
function onCancel(state: GestureState | null, sample: GestureSample): GestureOutcome {
  if (state === null) return ignored(null);
  if (sample.stream === "pointer") {
    if (state.pointerId !== sample.id) return ignored(state);
    if (sample.pointerType === "touch" && state.touchId !== null) {
      return claimed({ ...state, pointerCancelled: true });
    }
  } else if (state.touchId !== sample.id) {
    return ignored(state);
  }
  return { state: null, traceChanged: true, claimed: true, submit: null };
}

/**
 * Extends/unwinds the trace for the tile a movement sample landed on.
 *
 * Only a sample the finger is clearly inside a tile may move the trace; an
 * ambiguous sample — in the gap, or clipping an edge or corner — is ignored,
 * so it neither selects nor unwinds a tile. A movement sample normally lands
 * on one 8-way neighbour: landing on the current tile changes nothing,
 * landing on the immediately previous tile unwinds it (backtracking), and a
 * fast swipe that skipped a tile is bridged with an 8-way **stair-step walk**
 * from the last selected tile so no crossed tile is lost. The path stays
 * valid: a step onto an already-selected tile is rejected.
 */
function extend(state: GestureState, sample: GestureSample): GestureOutcome {
  if (sample.tile < 0 || !sample.clear) return ignored(state);
  const trace = state.trace;
  const last = trace[trace.length - 1];
  if (last === undefined || sample.tile === last) return ignored(state);
  const prev = trace[trace.length - 2];
  if (sample.tile === prev) {
    return changed({ ...state, trace: trace.slice(0, -1) });
  }
  const steps = bridgeSteps(last, sample.tile);
  if (steps.length === 0 || steps.some((step) => trace.includes(step))) return ignored(state);
  return changed({ ...state, trace: [...trace, ...steps] });
}

/**
 * The run of 8-way adjacent tiles from `from` to `to` that closes a gap
 * between sparse samples: it excludes `from`, ends at `to`, and takes one row
 * and/or column toward the target each step (diagonal-first stair-step).
 * Empty when `from === to`.
 */
function bridgeSteps(from: number, to: number): number[] {
  const steps: number[] = [];
  let row = Math.floor(from / 4);
  let col = from % 4;
  const toRow = Math.floor(to / 4);
  const toCol = to % 4;
  while (row !== toRow || col !== toCol) {
    row += Math.sign(toRow - row);
    col += Math.sign(toCol - col);
    steps.push(row * 4 + col);
  }
  return steps;
}

/** A sample that changed the trace and is part of the live gesture. */
function changed(state: GestureState): GestureOutcome {
  return { state, traceChanged: true, claimed: true, submit: null };
}

/** A sample that joined a stream without changing the trace, but is claimed. */
function claimed(state: GestureState): GestureOutcome {
  return { state, traceChanged: false, claimed: true, submit: null };
}

/** A sample that changed nothing. */
function ignored(state: GestureState | null): GestureOutcome {
  return { state, traceChanged: false, claimed: false, submit: null };
}
