import { afterEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, fixedBoard, joinPlayer, makeScene, type Scene } from "./scene.js";
import type { TestClient } from "./test-client.js";

const WORDS = ["test", "wort"];

function record(client: TestClient): string[] {
  const events: string[] = [];
  client.ws.on("message", (data) => {
    events.push((JSON.parse(data.toString()) as { type: string }).type);
  });
  return events;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function playRound(scene: Scene) {
  const { host, snap } = await createRoom(scene, "Hansi");
  host.send({ type: "start-round", reqId: 1 });
  await host.expect((m) => m.type === "round-start");
  return { host, snap };
}

let scene: Scene;
afterEach(async () => {
  await scene.stop();
});

describe("Wiktionary links after round-end", () => {
  test("a finished round's lookup broadcasts wiki-links with exactly the fake's mapping", async () => {
    const links = new Map([
      ["test", "https://de.wiktionary.org/wiki/Test"],
      ["wort", "https://de.wiktionary.org/wiki/Wort"],
    ]);
    scene = await makeScene({
      ...FAST_CLOCK,
      generateBoard: () => ({ board: fixedBoard(), words: WORDS }),
      lookupWikiLinks: async () => links,
    });

    const { host } = await playRound(scene);
    await host.expect((m) => m.type === "round-end", 4000);
    const message = await host.expect((m) => m.type === "wiki-links", 2000);

    expect(message.roundNumber).toBe(1);
    expect(message.links).toEqual(Object.fromEntries(links));
  });

  test("the round-end reveal is delivered before the lookup resolves", async () => {
    const pending = deferred<Map<string, string>>();
    let called = false;
    scene = await makeScene({
      ...FAST_CLOCK,
      generateBoard: () => ({ board: fixedBoard(), words: WORDS }),
      lookupWikiLinks: () => {
        called = true;
        return pending.promise;
      },
    });

    const { host } = await playRound(scene);
    const end = await host.expect((m) => m.type === "round-end", 4000);
    expect(called).toBe(true);
    expect(end.type).toBe("round-end");

    pending.resolve(new Map([["test", "https://de.wiktionary.org/wiki/Test"]]));
    const message = await host.expect((m) => m.type === "wiki-links", 2000);
    expect(message.links).toEqual({ test: "https://de.wiktionary.org/wiki/Test" });
  });

  test("a failing lookup produces no wiki-links message and leaves round-end untouched", async () => {
    scene = await makeScene({
      ...FAST_CLOCK,
      generateBoard: () => ({ board: fixedBoard(), words: WORDS }),
      lookupWikiLinks: async () => {
        throw new Error("dictionary down");
      },
    });

    const { host } = await playRound(scene);
    const events = record(host);
    const end = await host.expect((m) => m.type === "round-end", 4000);
    expect((end.reveal as { groups: unknown[] }).groups).toBeTruthy();

    await wait(250);
    expect(events).not.toContain("wiki-links");
    expect(events).toContain("round-end");
  });

  test("an intermission snapshot re-sends the links the lookup already resolved", async () => {
    const links = new Map([
      ["test", "https://de.wiktionary.org/wiki/Test"],
      ["wort", "https://de.wiktionary.org/wiki/Wort"],
    ]);
    scene = await makeScene({
      ...FAST_CLOCK,
      generateBoard: () => ({ board: fixedBoard(), words: WORDS }),
      lookupWikiLinks: async () => links,
    });

    const { host, snap } = await playRound(scene);
    await host.expect((m) => m.type === "round-end", 4000);
    await host.expect((m) => m.type === "wiki-links", 2000);

    const late = await joinPlayer(scene, snap.room.code, "Spät");
    const finished = (late.snap as SnapshotMsg).finishedRound!;
    expect(finished.links).toEqual(Object.fromEntries(links));
  });
});
