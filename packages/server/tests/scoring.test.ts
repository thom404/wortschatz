import { describe, expect, test } from "vitest";
import type { SnapshotMsg, WordAcceptedMsg } from "@wortschatz/shared";
import { PlaceholderDictionary } from "../src/defaults.js";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";
import type { TestClient } from "./test-client.js";

/**
 * #16: real German Scrabble scoring through the single server seam — real
 * WebSocket clients against the in-process server with the real score
 * engine injected, boards/dictionaries injected, wire payloads asserted.
 */

/**
 * Serpentine cell order: row 0 left→right, down, row 1 right→left, … so a
 * word's letters laid in this order form one legal 8-way path.
 */
const PATH = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];

function boardFor(...words: string[]): string[] {
  const board = new Array<string>(16).fill("e");
  let i = 0;
  for (const w of words) {
    for (const ch of w) {
      board[PATH[i++ % 16]!] = ch;
    }
  }
  return board;
}

interface Game {
  scene: Scene;
  host: TestClient;
  hostSeatId: number;
  player: TestClient;
  playerSeatId: number;
  playerToken: string;
  code: string;
}

async function startGame(words: readonly string[], board: string[]): Promise<Game> {
  const scene = await makeScene({
    ...FAST_CLOCK,
    dictionary: new PlaceholderDictionary([...words]),
    generateBoard: () => ({ board, words: [] }),
  });
  const { host, snap } = await createRoom(scene, "Hansi");
  const { player, snap: psnap } = await joinPlayer(scene, snap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 1 });
  await host.expect((m) => m.type === "round-start");
  return {
    scene,
    host,
    hostSeatId: snap.self.seatId,
    player,
    playerSeatId: psnap.self.seatId,
    playerToken: psnap.self.token!,
    code: snap.room.code,
  };
}

async function withGame<T>(
  words: readonly string[],
  board: string[],
  run: (g: Game) => Promise<T>
): Promise<T> {
  const game = await startGame(words, board);
  try {
    return await run(game);
  } finally {
    await game.scene.stop();
  }
}

async function submit(client: TestClient, word: string, reqId: number): Promise<WordAcceptedMsg> {
  client.send({ type: "submit-word", word, reqId });
  const ack = await client.expect((m) => m.type === "word-accepted" && m.reqId === reqId, 4000);
  return ack as unknown as WordAcceptedMsg;
}

async function resync(c: TestClient, reqId = 99): Promise<SnapshotMsg> {
  c.send({ type: "resync", reqId });
  const snap = await c.expect((m) => m.type === "snapshot" && m.reqId === reqId);
  return snap as unknown as SnapshotMsg;
}

/* ------------------------------------------------------------------ */
/* Every tile letter carries its true table value over the wire        */
/* ------------------------------------------------------------------ */

// Enough words that every letter of the canonical table appears in an
// accepted verdict: word → exact point total.
const TABLE_CASES: readonly (readonly [string, number])[] = [
  ["adriane", 7], // a d r i n e — the whole value-1 class
  ["stur", 4], // s t u r
  ["mut", 5], // m = 3
  ["blitz", 10], // b l z — b 3, l 2, z 3
  ["box", 13], // o 2, x 8
  ["wall", 8], // w 3
  ["gelb", 8], // g 2
  ["pack", 13], // p 4, c 4
  ["quark", 17], // q 10, k 4
  ["tuft", 7], // f 4
  ["ära", 8], // ä 6
  ["jahr", 10], // j 6, h 2
  ["fünf", 15], // ü 6
  ["vier", 9], // v 6
  ["öde", 10], // ö 8
  ["yacht", 18], // y 10
  ["fuß", 7], // ß 2
];

describe("letter coverage of the German Scrabble table", () => {
  for (const [word, points] of TABLE_CASES) {
    test(`spells ${word} for exactly ${points}`, async () => {
      await withGame([word], boardFor(word), async (g) => {
        const ack = await submit(g.host, word, 10);
        expect(ack.points).toBe(points);
        expect(ack.word).toBe(word);
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/* Tile rules: multi-letter tiles and either/or                        */
/* ------------------------------------------------------------------ */

test("a digram tile scores the sum of its letters; its letters count toward length", async () => {
  // Two tiles spell this 3-letter word: `a` + `ch` — only the spelled
  // letters make length 3, and the `ch` tile contributes c(4) + h(2).
  await withGame(
    ["ach"],
    ["a", "ch", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e"],
    async (g) => {
      const ack = await submit(g.host, "ach", 10);
      expect(ack.points).toBe(7);
    }
  );
});

test("a three-letter digram tile sums every constituent letter: sch is 7", async () => {
  // `w` + `a` + `sch` spell "wasch": w(3) + a(1) + (s(1) + c(4) + h(2)) = 11.
  await withGame(
    ["wasch"],
    ["w", "a", "sch", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e"],
    async (g) => {
      const ack = await submit(g.host, "wasch", 11);
      expect(ack.points).toBe(11);
    }
  );
});

test("an either/or tile scores the spelled variant only", async () => {
  // Tiles h + e/ä + n + d + e spell "hände": h(2)+ä(6)+n(1)+d(1)+e(1) = 11;
  // summing both options would give 12.
  await withGame(
    ["hände"],
    ["h", "e/ä", "n", "d", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e"],
    async (g) => {
      const ack = await submit(g.host, "hände", 12);
      expect(ack.points).toBe(11);
    }
  );
});

test("a ß tile is worth 2 on an injected board", async () => {
  // "fuß": f(4) + u(1) + ß(2) = 7 — any other ß value drifts the total.
  await withGame(["fuß"], boardFor("fuß"), async (g) => {
    const ack = await submit(g.host, "fuß", 13);
    expect(ack.points).toBe(7);
  });
});

/* ------------------------------------------------------------------ */
/* Dedupe & credit                                                     */
/* ------------------------------------------------------------------ */

test("resubmitting a word this round is word-duplicate; never double-scored", async () => {
  await withGame(["test"], boardFor("test"), async (g) => {
    await submit(g.host, "test", 10);
    g.host.send({ type: "submit-word", word: "test", reqId: 11 });
    const err = await g.host.expect((m) => m.type === "error" && m.reqId === 11);
    expect(err.code).toBe("word-duplicate");
    const snap = await resync(g.host);
    expect(snap.self.cumulativeScore).toBe(4); // t e s t = 4, exactly once
  });
});

test("every finder earns full credit, each once per round", async () => {
  await withGame(["test", "wort"], boardFor("test", "wort"), async (g) => {
    const a1 = await submit(g.host, "test", 10);
    expect(a1.points).toBe(4);
    const a2 = await submit(g.player, "test", 20);
    expect(a2.points).toBe(a1.points); // full credit for every finder
    const b1 = await submit(g.player, "wort", 21);
    expect(b1.points).toBe(7); // w 3 + o 2 + r 1 + t 1
    const snap = await resync(g.player);
    const mine = snap.players.find((p) => p.seatId === g.playerSeatId)!;
    const other = snap.players.find((p) => p.seatId === g.hostSeatId)!;
    expect(mine.cumulativeScore).toBe(11); // test 4 + wort 7, duplicates impossible
    expect(other.cumulativeScore).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* Rejections hold with real values                                    */
/* ------------------------------------------------------------------ */

test("length ≥ 3, isFormable and list membership gate before any scoring", async () => {
  // The board can path "qqq" but the list has no such entry — no score.
  await withGame(
    ["test"],
    ["q", "q", "q", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e", "e"],
    async (g) => {
      g.host.send({ type: "submit-word", word: "qq", reqId: 10 });
      expect((await g.host.expect((m) => m.type === "error" && m.reqId === 10)).code).toBe("invalid-word");
      g.host.send({ type: "submit-word", word: "qqq", reqId: 11 });
      expect((await g.host.expect((m) => m.type === "error" && m.reqId === 11)).code).toBe("invalid-word");
      g.host.send({ type: "submit-word", word: "tst", reqId: 12 });
      expect((await g.host.expect((m) => m.type === "error" && m.reqId === 12)).code).toBe("invalid-word");
      const snap = await resync(g.host);
      expect(snap.self.cumulativeScore).toBe(0);
    }
  );
});

/* ------------------------------------------------------------------ */
/* Scoreboard propagation                                              */
/* ------------------------------------------------------------------ */

test("a room-wide score-update with true values follows every accepted verdict", async () => {
  await withGame(["test"], boardFor("test"), async (g) => {
    await submit(g.host, "test", 10);
    for (const c of [g.host, g.player]) {
      const su = await c.expect((m) => m.type === "score-update");
      expect(su.roundNumber).toBe(1);
      const mine = (su.scores as { seatId: number; roundScore: number; cumulativeScore: number }[]).find(
        (s) => s.seatId === (c === g.host ? g.hostSeatId : g.playerSeatId)
      )!;
      expect(mine.roundScore).toBe(c === g.host ? 4 : 0);
      expect(mine.cumulativeScore).toBe(c === g.host ? 4 : 0);
    }
  });
});

test("a reconnecting player finds its seat's scores intact in the snapshot", async () => {
  await withGame(["test", "wort"], boardFor("test", "wort"), async (g) => {
    await submit(g.host, "test", 10);
    await submit(g.player, "wort", 20);
    await g.player.close();

    const re = await g.scene.makeClient();
    re.send({ type: "join", code: g.code, nickname: "IGNORED", token: g.playerToken, reqId: 30 });
    const snap = (await re.expect((m) => m.type === "snapshot" && m.reqId === 30)) as unknown as SnapshotMsg;
    expect(snap.self.seatId).toBe(g.playerSeatId);
    expect(snap.self.cumulativeScore).toBe(7); // wort 7, kept across the drop
    const mine = snap.players.find((p) => p.seatId === g.playerSeatId)!;
    expect(mine.cumulativeScore).toBe(7);
    const host = snap.players.find((p) => p.seatId === g.hostSeatId)!;
    expect(host.cumulativeScore).toBe(4);
  });
});
