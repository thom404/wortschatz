# ADR-0017: Wiktionary links are the first outbound dependency

- Status: Accepted
- Date: 2026-10-20
- Ticket: [#144](https://github.com/thom404/wortschatz/issues/144)

## Context

The intermission reveal lists every findable word of the finished board, but
the game's word list is 676,000 lowercase inflected forms with no lemma, part
of speech, gender or translation. A player who meets an unknown form has to
leave the game and open a dictionary by hand, losing the reveal and often the
next round.

A measured 150-word sample showed Wikipedia resolving 9% of words and roughly
a quarter of those being a different word (`aufdecktest` → _Abdecktest_),
while German Wiktionary resolved 54%, always the exact form. The word list is
inflected forms; an encyclopedia is organized by lemma.

This is the app's first outbound network dependency. It needs an explicit
target, matching rule and failure policy so it is not mistaken for an
oversight or "improved" later into fuzzy search.

## Decision

1. **Target is German Wiktionary.** Links point at
   `https://de.wiktionary.org/wiki/<Titel>`, never Wikipedia and never another
   dictionary. There is no cross-wiki fallback.
2. **Matching is exact.** The lookup uppercases the first character (German
   titles are case-insensitive in the first letter), URL-encodes the rest and
   queries MediaWiki `action=query` with `redirects=1`,
   `prop=pageprops|info` and `ppprop=disambiguation`. Redirects are followed;
   missing pages and disambiguation pages produce no link. There is no search,
   lemma lookup, inflection stripping or sense choice. No link is preferable
   to a wrong link.
3. **The server owns the lookup.** The browser makes no dictionary request
   (`connect-src 'self'` is unchanged); it only receives URLs and renders
   ordinary anchors. One injected collaborator of shape
   `(words: string[]) => Promise<Map<string, string>>` carries the seam; the
   real implementation lives in `wiktionary.ts` and tests inject a fake.
4. **The reveal never waits.** The lookup starts after `round-end` has been
   broadcast. A resolved non-empty mapping is broadcast as `wiki-links` and
   stored on the room's finished round so an intermission snapshot can resend
   it. An empty or failed lookup sends nothing.
5. **Bounded and polite.** Requests batch 50 titles, deduplicate words within
   and across requests, and use a process-lifetime cache (there is no
   database). Negative results are cached for about a minute. A lookup has a
   roughly 800 ms budget, sends a descriptive `User-Agent` naming the
   project, spaces batches politely and honors `Retry-After`. There are no
   retries inside the reveal path.
6. **Failure is invisible.** Any timeout, rate limit, malformed response or
   transport error resolves to an empty map: no icons this round, and the
   reveal is exactly the reveal that existed before this feature. Round
   transitions and the pause remain fully usable without the dependency.

## Consequences

- A word with an entry gets a small `↗` anchor in its reveal row; a word
  without an entry has no element, no disabled state and no loading
  indicator. Missed words are eligible and inherit the row's dimming.
- Links are announced as _Bei Wiktionary nachschlagen_ and open in a new tab
  with `noopener noreferrer`, so the reveal, board and next round survive.
- Late links update the reveal in place; the board, timer and standings are
  not rebuilt.
- Because the cache dies with the process, a cold cache costs one batch
  request per round. If Wiktionary is down, the cost is bounded by the
  negative cache rather than one request per round.
- The app stays playable offline from the dictionary's point of view. No
  dictionary text is copied into the app, so no attribution or licensing
  work beyond linking is introduced.

## Suppressed alternatives

- **Wikipedia or a fallback between targets.** Rejected: it resolved far
  fewer inflected forms and often resolved them to unrelated lemmas.
- **Search or lemma guessing.** Rejected: it can silently send a player to a
  page about a different word; exact-form absence is honest.
- **Look up in the browser.** Rejected: it would expose every player's
  vocabulary and IP to a third party and require a CSP change.
- **Await the lookup before broadcasting the reveal.** Rejected: a slow
  dictionary would delay the end of every round.
- **Retry inside the reveal path.** Rejected: it spends the round budget and
  delays the pause; a negative cache covers the next round instead.
