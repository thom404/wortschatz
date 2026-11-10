/** Board generation now lives in the pure engine so the installed client can
 *  build solo boards with the same rules (ADR-0031). */
export * from "@wortschatz/engine/boardgen";
