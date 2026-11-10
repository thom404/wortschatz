import { tileStrings } from "@wortschatz/shared";
import { serverBoardIndex } from "./board-rotation.js";
import { displayWord } from "./display.js";
import {
  applyGestureSample,
  type GesturePhase,
  type GestureSample,
  type GestureStream,
  type PointerKind,
} from "./gesture.js";
import type { GameStore } from "./store.js";
import type { ViewState } from "./view-state.js";

/**
 * The drag/trace subsystem (#19, ADR-0030), created once per mount. It owns
 * the app-lifetime pointer and touch listeners, the point→tile hit-test and
 * clear-hit margin, trace painting, the two readings of a trace and the
 * submit decision. Game rendering and pointer handling stay separate: Game
 * only measures the gap, wires its rotation/leave controls and asks this
 * handle to paint after a rebuild or a rotation.
 *
 * The rules live in the pure `gesture` module (#120); this wiring turns each
 * event into a normalized `GestureSample`, feeds it to the reducer and paints
 * or submits what the reducer decides.
 *
 * One gesture, both streams (this supersedes the #19 "pointer events carry
 * touch; touch handlers no-op once a pointer drag is live" decision): a
 * gesture begun by a pointer event accepts continuation from touch events
 * and vice versa, because Android Firefox commits to a pointer drag while
 * delivering movement only as `touchmove`. Movement seen through both
 * streams hits the same tile, and a second real release finds no live
 * gesture, so each gesture submits exactly once. A `pointercancel` for a
 * touch pointer does not end a gesture the touch stream still carries; a
 * mouse/pen cancel, or a `touchcancel`, does end it. Scroll/zoom under the
 * finger stays prevented: `touch-action: none` on the board, plus
 * `preventDefault` while a touch sample is claimed.
 */

/** The one sentence the drag surface shows between words. */
export const TRACE_HINT = "Wische über die Felder, um ein Wort zu bilden.";

/** The shell-facing handle Game uses; the listeners themselves stay
 *  app-lifetime. `setHitMargin` takes the gap Game measured after a render,
 *  `paint` rehydrates the trace onto fresh DOM and `stop` unbinds everything. */
export interface GameDrag {
  setHitMargin(px: number): void;
  paint(): void;
  stop(): void;
}

export interface GameDragOptions {
  /** The `#screen` container; the pointer-down listener lives on it so a
   *  Game rebuild cannot double-bind. */
  root: HTMLElement;
  store: GameStore;
  view: ViewState;
  /** Hands one trace across the boundary. The shell owns the connection. */
  submit(word: string, alternate?: string): void;
}

export function createGameDrag(opts: GameDragOptions): GameDrag {
  const { root, store, view } = opts;
  let clearHitMargin = 0;

  /**
   * One browser event as a normalized sample: the wiring resolves the point
   * to a tile and decides whether the finger is clearly inside it, so the
   * rules stay geometry-free.
   */
  const sampleFor = (
    phase: GesturePhase,
    stream: GestureStream,
    id: number,
    x: number,
    y: number,
    target: EventTarget | null,
    pointerType?: PointerKind
  ): GestureSample => {
    const tile = hitTileIndex(x, y, target);
    return {
      phase,
      stream,
      id,
      point: { x, y },
      tile,
      clear: tile >= 0 && clearHit(tile, x, y),
      ...(pointerType ? { pointerType } : {}),
    };
  };

  /** Feeds one sample to the rules and paints/submits what they decide.
   *  Returns whether the sample was claimed, so a touch handler can stop
   *  the page from scrolling or zooming under the finger. */
  const feed = (sample: GestureSample): boolean => {
    const outcome = applyGestureSample(view.gesture, sample);
    view.gesture = outcome.state;
    if (outcome.submit) submitTrace(outcome.submit);
    else if (outcome.traceChanged) paint();
    return outcome.claimed;
  };

  /** A press only opens a gesture on the player's own, live board; a press
   *  during a live gesture only joins its stream. */
  const mayBegin = () => store.phase === "playing" && store.self.role !== "spectator";

  const onPointerDown = (ev: PointerEvent) => {
    if (!view.gesture && !mayBegin()) return;
    feed(sampleFor("down", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerMove = (ev: PointerEvent) => {
    feed(sampleFor("move", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerUp = (ev: PointerEvent) => {
    feed(sampleFor("up", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerCancel = (ev: PointerEvent) => {
    feed(sampleFor("cancel", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };

  const onTouchStart = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (!view.gesture && !mayBegin()) return;
    if (feed(sampleFor("down", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (feed(sampleFor("move", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchEnd = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : view.gesture?.touchId;
    if (id === null || id === undefined) return;
    feed(sampleFor("up", "touch", id, t?.clientX ?? 0, t?.clientY ?? 0, t?.target ?? null));
  };
  const onTouchCancel = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : view.gesture?.touchId;
    if (id === null || id === undefined) return;
    feed(sampleFor("cancel", "touch", id, t?.clientX ?? 0, t?.clientY ?? 0, t?.target ?? null));
  };

  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onTouchCancel);

  /**
   * How far (px) inside every edge of a tile a movement sample must land to
   * count as a clear hit. `measureBoardGap` reads it from the board's
   * computed gap (the `--board-gap` token) when the board renders: a sample
   * in that gap, or clipping a tile's edge or corner, rounds unpredictably to
   * whichever neighbour the browser's sub-pixel arithmetic picks, so it must
   * not move the trace. The gap stays well below half a cell, so a genuinely
   * crossed tile still offers clear ground.
   */
  function clearHit(tile: number, x: number, y: number): boolean {
    const el = root.querySelector("#board")?.children[tile];
    if (!el) return false;
    const box = el.getBoundingClientRect();
    return !(
      x - box.left < clearHitMargin ||
      box.right - x < clearHitMargin ||
      y - box.top < clearHitMargin ||
      box.bottom - y < clearHitMargin
    );
  }

  /** Ends the trace: painting restores the idle hint and, on a real release
   *  during play, the traced string crosses the boundary as `submit-word`. A
   *  choice tile on the path also carries its second reading, so the server
   *  can accept either valid word (ADR-0027). The gesture state is already
   *  cleared, so the paint goes idle. */
  function submitTrace(trace: number[]): void {
    paint();
    const { word, alternate } = traceReadings(trace);
    if (word && store.phase === "playing") {
      // A new submit is the action that addresses the previous rejection, so
      // the old verdict leaves at once (the shell's submit callback clears it).
      opts.submit(word, alternate);
    }
  }

  /** The string the trace shows and the optional second reading a choice
   *  tile offers. The trace holds grid cells, so the rotation maps a cell
   *  back to its server board index before reading the tile — the submitted
   *  word is always exactly what the tiles under the finger spell (issue
   *  #151). A board has at most one special, so there is at most one
   *  either/or tile to vary. */
  function traceReadings(trace: readonly number[]): { word: string; alternate?: string } {
    const board = store.round?.board ?? [];
    let word = "";
    let alternate = "";
    let varied = false;
    for (const cell of trace) {
      const variants = tileStrings(board[serverBoardIndex(cell, view.boardRotation)] ?? "");
      const first = variants[0] ?? "";
      word += first;
      const second = variants[1];
      if (!varied && second !== undefined) {
        alternate += second;
        varied = true;
      } else {
        alternate += first;
      }
    }
    return varied ? { word, alternate } : { word };
  }

  /** The primary reading the trace line shows. */
  function traceWord(trace: readonly number[]): string {
    return traceReadings(trace).word;
  }

  /** Point → tile resolution, the same for mouse and finger. Real browsers
   *  answer with `elementFromPoint` (events retarget under touch, so the
   *  event target is not the current tile); the target is only a fallback. */
  function hitTileIndex(x: number, y: number, target: EventTarget | null): number {
    if (!store.round) return -1;
    const board = root.querySelector("#board");
    if (!board) return -1;
    let el: Element | null = document.elementFromPoint(x, y);
    el = el ? el.closest(".tile") : null;
    if (!el && target instanceof Element) el = target.closest(".tile");
    if (!el || !board.contains(el)) return -1;
    const parent = el.parentElement;
    if (!parent) return -1;
    return Array.prototype.indexOf.call(parent.children, el);
  }

  /** Paints the trace onto the live DOM: `.sel` on selected tiles, the
   *  would-be word (or the idle hint) in the trace line. */
  function paint(): void {
    const trace = view.gesture?.trace ?? [];
    const board = root.querySelector("#board");
    if (board) {
      for (const el of board.children) el.classList.remove("sel");
      for (const idx of trace) {
        const el = board.children[idx];
        if (el) el.classList.add("sel");
      }
    }
    const el = root.querySelector<HTMLElement>("#trace");
    if (!el) return;
    if (trace.length > 0) {
      el.classList.remove("hint");
      el.textContent = displayWord(traceWord(trace));
    } else {
      el.classList.add("hint");
      el.textContent = TRACE_HINT;
    }
  }

  return {
    setHitMargin(px) {
      clearHitMargin = px;
    },
    paint,
    stop() {
      root.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    },
  };
}

/** A pointer event's `pointerType` (`lib.dom` types it as a plain string). */
function pointerKind(ev: PointerEvent): PointerKind {
  return ev.pointerType === "touch" || ev.pointerType === "pen" ? ev.pointerType : "mouse";
}
