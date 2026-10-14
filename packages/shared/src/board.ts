/**
 * The board as it travels on the wire: an opaque `string[16]`, row-major
 * (index 0–3 = top row, left→right). Which strings exist per tile and how a
 * board is generated are owned by ticket #7; this package only fixes the
 * shape so the wire contract compiles today.
 */
export type Board = string[];
