import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  EITHER_OR_MENU,
  TILE_BAG,
  PROTOCOL,
  isDigram,
  isEitherOr,
  neighbors,
  tileKind,
} from "@wortschatz/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";
import { createDictionary } from "../src/dictionary/index.js";
import { generateBoard } from "../src/boardgen/index.js";
import type { ServerConfig } from "../src/index.js";

const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);

const fixtureDict = () => createDictionary(FIXTURE_WORDS);

const DIGRAM_MENU = Object.keys(TILE_BAG).filter((t) => isDigram(t));
const SPECIAL_MENU = new Set<string>([...DIGRAM_MENU, ...EITHER_OR_MENU]);
const isSingleTile = (t: string): boolean => tileKind(t) === "single";
const isSpecialTile = (t: string): boolean => !isSingleTile(t);

function realCfg(seed = 42n, log?: ServerConfig["log"]): Partial<ServerConfig> {
  const dictionary = fixtureDict();
  return {
    dictionary,
    generateBoard: (s) => generateBoard(s, dictionary),
    seedSource: () => seed,
    scoreWord: (w) => w.length,
    reveal: () => ({ groups: [] }),
    log: log ?? { info() {}, warn() {}, error() {} },
    ...FAST_CLOCK,
  };
}

/** Scene whose rooms generate real boards from a pinned seed. */
async function realScene(seed = 42n, log?: ServerConfig["log"]): Promise<Scene> {
  return makeScene(realCfg(seed, log) as Partial<ServerConfig>);
}

async function startedRound(scene: Scene) {
  const { host, snap } = await createRoom(scene, "Hansi");
  await joinPlayer(scene, snap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 1 });
  const rs = (await host.expect((m) => m.type === "round-start")) as unknown as {
    round: { roundNumber: number; board: string[]; deadline: number };
  };
  return { host, snap, rs };
}

describe("board generation wiring", () => {
  let scene: Scene;
  beforeEach(async () => {
    scene = await realScene();
  });
  afterEach(async () => {
    await scene.stop();
  });

  test("round-start broadcasts 15 inventory singles and one position-free special", async () => {
    const { rs } = await startedRound(scene);
    expect(rs.round.board).toHaveLength(PROTOCOL.BOARD_SIZE);
    expect(rs.round.board.filter(isSpecialTile)).toHaveLength(1);
    for (const t of rs.round.board) {
      if (isSingleTile(t)) {
        expect(TILE_BAG[t], t).toBeGreaterThan(0);
      } else {
        expect(SPECIAL_MENU.has(t), t).toBe(true);
        expect(isDigram(t) || isEitherOr(t), t).toBe(true);
      }
    }
    expect(rs.round.roundNumber).toBe(1);
    expect(rs.round.deadline).toBeGreaterThan(Date.now());
  });

  test("the same seed produces the same board in every room", async () => {
    const { rs: a } = await startedRound(scene);
    const { rs: b } = await startedRound(scene);
    expect(b.round.board).toEqual(a.round.board);
  });

  test("round-start logs the seed", async () => {
    const events: Record<string, unknown>[] = [];
    const seeded = await realScene(99n, {
      info: (o) => events.push(o),
      warn() {},
      error() {},
    });
    try {
      await startedRound(seeded);
      const rs = events.find((e) => e["event"] === "round-start")!;
      expect(String(rs["seed"])).toBe("99");
    } finally {
      await seeded.stop();
    }
  });
});

/* --------------------------------------------------------------------- */
/* Submission enforcement on a real board                                  */
/* --------------------------------------------------------------------- */

describe("submissions against a real generated board", () => {
  let scene: Scene;
  beforeEach(async () => {
    scene = await realScene();
  });
  afterEach(async () => {
    await scene.stop();
  });

  test("a formable list word scores, an unformable list word is rejected as not placeable", async () => {
    const { host, rs } = await startedRound(scene);
    const dictionary = fixtureDict();
    const found = dictionary.findWords(rs.round.board);
    const all = FIXTURE_WORDS.map((w) => w.toLowerCase());
    const missing = all.filter((w) => !found.includes(w));
    // The pinned seed must actually give the round playable words.
    expect(found.length).toBeGreaterThan(0);

    const formable = [...found].sort((a, b) => a.length - b.length)[0];
    host.send({ type: "submit-word", word: formable, reqId: 20 });
    const ack = await host.expect((m) => m.type === "word-accepted" && m.reqId === 20, 4000);
    expect(ack.word).toBe(formable);
    expect(ack.points).toBe(formable.length);

    expect(missing.length).toBeGreaterThan(0);
    const unformable = missing[0];
    host.send({ type: "submit-word", word: unformable, reqId: 21 });
    const err = await host.expect((m) => m.type === "error" && m.reqId === 21, 4000);
    expect(err.code).toBe("invalid-word");
    expect(err.message).toBe("not placeable");
  });

  test("formability is checked before membership: an off-list dead word answers 'not placeable'", async () => {
    const { host, rs } = await startedRound(scene);
    const dictionary = fixtureDict();
    // A letter absent from the board makes any spelling of it unformable.
    const boardLetters = new Set(rs.round.board.join(""));
    const missingLetter = "aeiourstnlhkdc".split("").find((l: string) => !boardLetters.has(l));
    const word = (missingLetter ?? "z").repeat(3);
    // Discriminator: membership false AND unformable — only the submit
    // *order* decides which error message comes back.
    expect(dictionary.isValid(word)).toBe(false);
    host.send({ type: "submit-word", word, reqId: 22 });
    const err = await host.expect((m) => m.type === "error" && m.reqId === 22, 4000);
    expect(err.code).toBe("invalid-word");
    expect(err.message).toBe("not placeable");
  });

  test("generation places exactly one special tile and no identical neighbours", async () => {
    const seeded = await realScene(5n);
    try {
      const { rs } = await startedRound(seeded);
      expect(rs.round.board.filter(isSpecialTile)).toHaveLength(1);
      for (let cell = 0; cell < rs.round.board.length; cell++) {
        for (const nb of neighbors(cell)) {
          if (nb > cell) {
            expect(rs.round.board[nb], `cells ${cell}/${nb}`).not.toBe(rs.round.board[cell]);
          }
        }
      }
    } finally {
      await seeded.stop();
    }
  });
});
