/**
 * Heading anchors, in the dialect GitHub renders and every static-site
 * generator copied from it.
 *
 * The app had no anchor scheme at all before this: exported HTML numbered
 * comment anchors (`anchor-0`) and gave headings nothing. Adopting GitHub's is
 * the choice that makes a copied link work in the places a `.md` file actually
 * ends up — a repository, a wiki, a docs site — rather than only inside this
 * app. It is a convention, not a standard, which is why the rules are written
 * out here instead of being left implicit in a regex.
 */

/**
 * Lowercase; strip everything that is not a letter, number, space or hyphen;
 * each remaining space becomes a hyphen.
 *
 * Each space, not each run: removing "&" from "replace & go" leaves two
 * adjacent spaces, and GitHub turns those into two hyphens. Collapsing them
 * would give a tidier anchor that does not resolve on the site the convention
 * was copied from, which defeats the point of following it.
 *
 * Unicode-aware on purpose. A Greek heading has to produce a Greek anchor —
 * this app ships Greek fonts and a Greek-subset webfont, so `[^a-z0-9]` would
 * quietly reduce half the intended headings to the empty string.
 */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

/**
 * The anchor for one heading, ignoring any others.
 *
 * Use `slugsFor` when slugging a whole document: two headings with the same
 * text need different anchors, and this cannot know about its neighbours.
 */
export function slugify(text: string): string {
  return normalize(text)
}

/**
 * Anchors for a document's headings, in order, de-duplicated.
 *
 * Repeated headings get `-1`, `-2` and so on after the first, which is what
 * GitHub does and what makes the anchors stable enough to link to. A heading
 * that normalizes to nothing — one made entirely of punctuation or emoji —
 * falls back to `section`, so it still gets a usable, unique anchor instead of
 * a link to `#`.
 */
export function slugsFor(headings: readonly string[]): string[] {
  const seen = new Map<string, number>()

  return headings.map(text => {
    const base = normalize(text) || 'section'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  })
}
