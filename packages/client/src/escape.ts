/**
 * The one home for escaping text and attribute values into HTML (ADR-0015:
 * one home per rule at each seam).
 *
 * The five characters are a superset of what a text node needs and what a
 * quoted attribute value needs, so `escapeHtml` serves both positions: `&`,
 * `<` and `>` cover text, while `"` and `'` cover attributes. Escaping quotes
 * in text too costs nothing and removes the choice between two spellings that
 * would behave identically. The function only replaces characters; it does not
 * trim, normalize or decode.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
