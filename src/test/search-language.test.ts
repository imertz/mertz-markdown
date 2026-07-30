import { describe, expect, it } from 'vitest'
import { create, getByID, insertMultiple, remove, search } from 'zbsearch'
import { stemToken } from '../search/stemmer'

/**
 * Phase 0 spike.
 *
 * The ZBSearch docs are ambiguous in exactly the places that decide the index
 * schema, so every assumption `src/search/` is built on is pinned here first.
 * If one of these fails, the schema changes — not the calling code.
 *
 * Kept as a permanent test rather than deleted after the spike: these are
 * upstream behaviours we depend on, and a patch bump that changes one of them
 * should fail the build rather than quietly degrade search.
 */

const SCHEMA = {
  docId: 'enum',
  text: 'string',
  headingPath: 'string',
  kind: 'enum',
  source: 'enum',
  trashed: 'boolean',
  updatedAt: 'number',
} as const

const DOC_A = '73cbcc79-2203-49b8-bb52-60d8e9a66c5f'
const DOC_B = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

interface Passage {
  id: string
  docId: string
  text: string
  headingPath: string
  kind: string
  source: string
  trashed: boolean
  updatedAt: number
  // Stored but undeclared — the payload the panel renders without a second read.
  title?: string
  anchor?: { exact: string; prefix: string; suffix: string }
}

const passage = (over: Partial<Passage> & Pick<Passage, 'id' | 'text'>): Passage => ({
  docId: DOC_A,
  headingPath: '',
  kind: 'paragraph',
  source: 'document',
  trashed: false,
  updatedAt: 1,
  ...over,
})

/** The production configuration, so these assertions describe what ships. */
const build = async (docs: Passage[]) => {
  const db = create({
    schema: SCHEMA,
    components: { tokenizer: { language: 'multilingual', stemmer: stemToken } },
  })
  await insertMultiple(db, docs)
  return db
}

describe('zbsearch runtime assumptions', () => {
  it('has Intl.Segmenter, so tests exercise the same tokenizer as production', () => {
    // Without this, multilingual mode silently falls back to a Unicode regex
    // and every other assertion here would be testing the wrong code path.
    expect(typeof Intl.Segmenter).toBe('function')
  })

  it('tokenizes Greek under multilingual mode', async () => {
    const db = await build([
      passage({ id: 'a#0', text: 'Η γραμματοσειρά GFS Neohellenic είναι ελληνική' }),
      passage({ id: 'a#1', text: 'An English paragraph about fonts' }),
    ])

    const hits = await search(db, { term: 'γραμματοσειρά', properties: ['text'] })
    expect(hits.count).toBe(1)
    expect(hits.hits[0].document.id).toBe('a#0')
  })

  it('folds Latin diacritics, so an unaccented query finds accented text', async () => {
    const db = await build([passage({ id: 'a#0', text: 'We drank café on the square' })])

    // This is what forces the snippet highlighter to fold too: the engine
    // matches text the raw query string does not literally appear in.
    expect((await search(db, { term: 'cafe', properties: ['text'] })).count).toBe(1)
    expect((await search(db, { term: 'café', properties: ['text'] })).count).toBe(1)
  })

  it('does NOT fold Greek diacritics without help', async () => {
    // The docs claim multilingual mode folds diacritics generally. It does not:
    // `replaceDiacritics` maps charCodes 192-383 (Latin) plus a handful of
    // Cyrillic/Arabic letters, and every accented Greek vowel sits above that
    // range. Pinned so an upstream fix is noticed rather than silently doubling
    // the folding we now do ourselves.
    const bare = create({ schema: SCHEMA, language: 'multilingual' })
    await insertMultiple(bare, [passage({ id: 'a#0', text: 'Ήπιαμε καφές στην πλατεία' })])

    expect((await search(bare, { term: 'καφές', properties: ['text'] })).count).toBe(1)
    expect((await search(bare, { term: 'καφες', properties: ['text'] })).count).toBe(0)
  })

  it('matches Greek regardless of accent once the stemmer is wired in', async () => {
    // `stemmer` runs on indexed and query tokens alike, which makes it
    // symmetric by construction. Note `language` has to move inside the
    // tokenizer config — create() rejects being given both.
    const db = await build([
      passage({ id: 'a#0', text: 'Ήπιαμε καφές στην πλατεία' }),
      passage({ id: 'a#1', text: 'We drank café on the square' }),
    ])

    expect((await search(db, { term: 'καφες', properties: ['text'] })).count).toBe(1)
    expect((await search(db, { term: 'καφές', properties: ['text'] })).count).toBe(1)
    // Latin folding still happens upstream of the stemmer.
    expect((await search(db, { term: 'cafe', properties: ['text'] })).count).toBe(1)
  })

  it('matches across inflections in both languages', async () => {
    // The recall the bare multilingual tokenizer gives up: it has no stemming,
    // so only the exact written form is findable.
    const db = await build([
      passage({ id: 'a#0', text: 'She was running along the square' }),
      passage({ id: 'a#1', text: 'Περπατήσαμε στις πλατείες της πόλης' }),
    ])

    expect((await search(db, { term: 'run', properties: ['text'] })).count).toBe(1)
    expect((await search(db, { term: 'πλατεία', properties: ['text'] })).count).toBe(1)
  })

  it('routes each token to the stemmer for its own script', () => {
    // A Greek word must not be put through the Porter stemmer, and vice versa.
    // Equal stems for two surface forms is the observable proof it routed right.
    expect(stemToken('καφές')).toBe(stemToken('καφες'))
    expect(stemToken('running')).toBe(stemToken('run'))
    // Final sigma is a Greek-only rule; the English stemmer knows nothing of it.
    expect(stemToken('πλατείας')).toBe(stemToken('πλατείας'.replace('ς', 'σ')))
  })

  it('filters an enum docId by a raw UUID', async () => {
    // The reason docId is `enum` and not `string`: multilingual word
    // segmentation would split a UUID on its hyphens, and an exact-token
    // filter would never match the whole thing again.
    const db = await build([
      passage({ id: 'a#0', text: 'alpha beta', docId: DOC_A }),
      passage({ id: 'a#1', text: 'alpha gamma', docId: DOC_A }),
      passage({ id: 'b#0', text: 'alpha delta', docId: DOC_B }),
    ])

    const hits = await search(db, {
      term: 'alpha',
      properties: ['text'],
      where: { docId: { eq: DOC_A } },
    })

    expect(hits.count).toBe(2)
    expect(hits.hits.map(hit => hit.document.docId)).toEqual([DOC_A, DOC_A])
  })

  it('filters a boolean, so one index serves live documents and trash', async () => {
    const db = await build([
      passage({ id: 'a#0', text: 'alpha live' }),
      passage({ id: 'b#0', text: 'alpha binned', docId: DOC_B, trashed: true }),
    ])

    const live = await search(db, {
      term: 'alpha',
      properties: ['text'],
      where: { trashed: false },
    })

    expect(live.count).toBe(1)
    expect(live.hits[0].document.id).toBe('a#0')
    expect((await search(db, { term: 'alpha', properties: ['text'] })).count).toBe(2)
  })

  it('refuses to groupBy an enum property', async () => {
    // This is why the panel groups by docId in plain JS. `enum` is the right
    // type for docId (see the UUID filter test above), and groupBy only accepts
    // string/number/boolean — so the two cannot be reconciled. Grouping the
    // ranked hits ourselves also gives documents a defined order: best passage
    // first, which is what the UI wants and what groupBy never promised.
    const db = await build([
      passage({ id: 'a#0', text: 'alpha one' }),
      passage({ id: 'b#0', text: 'alpha two', docId: DOC_B }),
    ])

    // Thrown synchronously, not returned as a rejected promise — `search` only
    // reaches for a Promise when a component makes it async.
    expect(() =>
      search(db, {
        term: 'alpha',
        properties: ['text'],
        groupBy: { properties: ['docId'] },
      }),
    ).toThrow(/Invalid groupBy property/)
  })

  it('counts facets over the whole match set, not the returned page', async () => {
    const db = await build([
      passage({ id: 'a#0', text: 'alpha one' }),
      passage({ id: 'a#1', text: 'alpha two' }),
      passage({ id: 'c#0', text: 'alpha said', source: 'comment', kind: 'comment' }),
    ])

    const hits = await search(db, {
      term: 'alpha',
      properties: ['text'],
      limit: 1,
      facets: { source: {} },
    })

    // The whole point of using facets rather than counting hits: `limit: 1`
    // returns one row, but the chips must still say 2 and 1.
    expect(hits.hits.length).toBe(1)
    expect(hits.facets?.source.values).toMatchObject({ document: 2, comment: 1 })
  })

  it('keeps an undeclared id addressable, and returns undeclared payload', async () => {
    const db = await build([
      passage({
        id: 'a#0',
        text: 'alpha one',
        title: 'A document',
        anchor: { exact: 'alpha one', prefix: '', suffix: '' },
      }),
    ])

    // `id` is deliberately absent from SCHEMA so UUID tokens never reach the
    // inverted index — but it must still drive getByID and remove.
    const stored = (await getByID(db, 'a#0')) as Passage | undefined
    expect(stored?.title).toBe('A document')
    expect(stored?.anchor?.exact).toBe('alpha one')

    await remove(db, 'a#0')
    expect((await search(db, { term: 'alpha', properties: ['text'] })).count).toBe(0)
  })

  it('does not match undeclared payload as search terms', async () => {
    const db = await build([
      passage({ id: 'a#0', text: 'nothing relevant here', title: 'Quarterly' }),
    ])

    // If `title` were indexed, this would return the passage — which is the
    // flooding problem the `kind: 'title'` record exists to avoid.
    expect((await search(db, { term: 'Quarterly', properties: ['text'] })).count).toBe(0)
  })

  it('requires every term at threshold 0', async () => {
    const db = await build([
      passage({ id: 'a#0', text: 'the quarterly review went well' }),
      passage({ id: 'a#1', text: 'a review of nothing in particular' }),
    ])

    const loose = await search(db, { term: 'quarterly review', properties: ['text'] })
    const strict = await search(db, {
      term: 'quarterly review',
      properties: ['text'],
      threshold: 0,
    })

    // Without threshold 0, "quarterly review" drags in everything containing
    // just "review" — the single biggest relevance lever we have.
    expect(loose.count).toBe(2)
    expect(strict.count).toBe(1)
    expect(strict.hits[0].document.id).toBe('a#0')
  })
})
