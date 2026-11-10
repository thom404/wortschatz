/**
 * The pure game-rules engine shared by the server and the installed client.
 *
 * It owns word normalization, board generation and its RNG, the DAWG
 * dictionary (build, serialize, deserialize, membership, board enumeration),
 * formability, the one submission verdict and the reveal builder. It imports
 * nothing from Node: `@wortschatz/shared` carries the wire, board geometry,
 * tile inventory and scoring table, while every game rule lives here.
 */
export * from "./text.js";
export * from "./boardgen/rng.js";
export * from "./boardgen/index.js";
export * from "./dictionary/dawg.js";
export * from "./dictionary/dawg-blob.js";
export * from "./dictionary/index.js";
export * from "./reveal.js";
export * from "./submission.js";
export { LETTER_VALUES, MIN_VALUE, charScore, tileValues, wordScore } from "@wortschatz/shared";
