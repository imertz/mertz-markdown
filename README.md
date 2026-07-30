<div align="center">

<img src="public/pwa-192x192.png" alt="" width="88" height="88">

<h1>Yiannis Mertzanis' Markdown</h1>

<p>
  <strong>An offline-first, installable markdown editor with inline comments.</strong><br>
  WYSIWYG editing, everything stored locally in IndexedDB, and exported
  <code>.md</code> files that stay clean GFM.
</p>

<p><a href="https://markdown.mysolon.gr"><strong>Try it → markdown.mysolon.gr</strong></a></p>

</div>

![The editor with a document open: rich text on the left, five comment threads anchored to their spans in the right-hand rail, and the selection bubble offering Comment and Link](showcase.png)

```bash
bun install
bun run dev        # http://localhost:5173
bun run test       # 536 tests
bun run build      # tsc -b && vite build (emits the service worker)
bun run preview    # serve the production build, service worker active
```

## The one guarantee

**Exported markdown contains no trace of the app.** No HTML wrappers, no entity
references, no proprietary syntax — nothing that a conforming CommonMark/GFM
parser would render as anything other than what you wrote.

That is not a convention; it is enforced by tests. `src/test/schema-lock.test.ts`
and `src/test/markdown-roundtrip.test.ts` fail the build if any of it slips.

### How comments stay out of the file

Markdown has no syntax for "this span carries comment thread X", so markdown
cannot be the canonical stored form — every save would destroy the anchors.

| Artifact | Role | Where |
|---|---|---|
| ProseMirror JSON | **Canonical.** Comment marks live here and nowhere else. | IndexedDB `documents.doc` |
| Markdown string | **Derived** on every save. Zero comment traces. | IndexedDB `documents.markdown` |
| Threads + comments | **Sidecar**, never touches the `.md`. | IndexedDB `threads` / `comments` |
| Image blobs | **Sidecar.** Nodes keep a lightweight id and standard relative path. | IndexedDB `assets` |

The comment mark (`src/editor/extensions/comment.ts`) deliberately declares **no**
`renderMarkdown`. `@tiptap/markdown`'s `getMarkOpening` returns `""` for a mark
with no renderer, so invisibility is the default-safe path rather than something
to remember. That omission is load-bearing — the schema-lock test asserts it.

Because anchors ride on ProseMirror marks, they follow edits automatically. A
W3C `TextQuoteSelector` is stored alongside each thread as a fallback, used to
re-anchor when a plain `.md` is imported (`src/markdown/anchors.ts`).

## Dialect: GFM

CommonMark plus tables, task lists and `~~strikethrough~~`. GFM is a formal spec
and a strict superset of CommonMark.

**`underline` is disabled on purpose.** StarterKit ships it enabled and it
serializes to `++text++`, which is Pandoc syntax — neither CommonMark nor GFM. A
conforming parser renders literal plus signs. `markdown/config.ts` holds the
allowlists; anything added to the schema without a matching entry fails the
schema-lock test.

Two upstream quirks are handled in `src/markdown/`:

- **Inline-code fencing** (`codeSpans.ts`). `@tiptap/extension-code` always emits
  a single backtick, so `` ``a ` b`` `` serialized to broken, non-idempotent
  output. Re-fenced per CommonMark §6.1.
- **`&nbsp;` and trailing paragraphs** (`export.ts`). Stripped by
  `normalizeDocForExport`. `toMarkdown()` is the only sanctioned way markdown
  leaves the app; a test greps for direct `getMarkdown()` calls.

## Beyond the editor

Everything below is built on the same rule: nothing reaches the `.md`.

- **Find and replace** (`⌘F`) is decorations only — searching never touches the
  document, so `⌘Z` after a search still undoes your last *edit*. Replace-all
  lands as a single undo step.
- **Command palette** (`⌘K`) fuzzy-searches documents, the live heading outline
  and the commands, from one field.
- **Search across documents** (`⌘⇧F`) is full-text, not title-only: BM25 over
  every passage of every document, its comments and its trash, ranked and
  grouped by document. Picking a hit opens the document and puts the caret on
  the passage, by handing the passage's `TextQuoteSelector` to the same
  resolver comment re-anchoring uses. The index lives in memory, is rebuilt
  from IndexedDB, and is updated at the same choke point that writes a
  document — `src/test/search-index-guard.test.ts` fails the build if a write
  ever bypasses it, because a stale index reports no error at all.
- **Links** (`⌘⇧K`) get a popover instead of nothing: the mark was always in the
  schema with no UI. Bare hosts gain `https://`, bare addresses become
  `mailto:`, and `javascript:` is refused.
- **Version history.** Snapshots are written at most every 5 minutes per
  document, capped at 50, and pruned oldest-first. A snapshot stores canonical
  ProseMirror JSON — markdown could not carry the anchors — so restoring brings
  the comments back with the text. Restoring is `setContent`: one ordinary,
  undoable transaction that the normal autosave persists through `toMarkdown`.
- **Trash.** Deleting is a `deletedAt` tombstone plus a 6-second undo toast;
  threads, comments and snapshots survive until the 30-day purge, which is the
  only thing that cascades.
- **Syntax highlighting** in code blocks, via lowlight's `common` grammar set.
  Decorations again, over the same `codeBlock` node — the ` ```lang ` fence
  round-trips exactly as before.
- **Opening files.** The manifest always declared `file_handlers` for
  `text/markdown`; `launchQueue` now actually consumes them, and `.md` files can
  be dropped anywhere on the window.
- **Images.** Drop or paste a PNG, JPEG, GIF, WebP or AVIF, choose files from
  the toolbar, or insert an HTTP(S) URL. URL images can remain remote or be
  copied into IndexedDB for offline use. Selected images have aspect-locked
  resize handles, an exact width field, alt-text editing and a free/preset crop
  dialog. Crops become new WebP assets while the source remains available to
  undo and version history. Documents with local images export as ZIPs with
  clean Markdown and an `images/` directory; annotated HTML embeds the bytes.
- **Table editing.** A bar floats over the table the caret is in: add and delete
  rows and columns, set column alignment, toggle the header row, delete the
  table. Only operations GFM can actually express are offered — merged cells and
  header *columns* are deliberately absent, because the serializer emits cells
  positionally and both silently corrupt the file. Cells are constrained to a
  single paragraph so the editor cannot show something the `.md` cannot hold.
- **Export with comments** is a *separate* `.html` file
  (`src/markdown/exportHtml.ts`), never an option on the `.md` export. The body
  comes from the schema's own DOM serializer, so the anchors highlight for free,
  and the threads follow as a numbered annex. It shares no code with the
  markdown path — which is the point.

## Known limitations

- **Loose lists normalize to tight.** ProseMirror's list schema has no
  loose/tight distinction. No content is lost; the output is idempotent.
- **Escaping is aggressive.** `snake_case` exports as `snake\_case`. Valid
  CommonMark (§2.4) and renders correctly everywhere, just noisier than
  hand-written markdown. Over-escaping is spec-safe; under-escaping is a bug.
- **Multi-tab editing of one document is last-write-wins.** No conflict
  detection. A tab whose database connection is closed by another tab's schema
  upgrade is told to reload rather than left writing into nothing.
- **Removed image blobs stay until the document is permanently purged.** Old
  snapshots may still reference them, so reclaiming them earlier would make a
  valid restore point display a broken image. Plain `.md` export is used when a
  document has no local images; otherwise export is a Markdown + images ZIP.
- **Remote images are not cached.** Their URLs round-trip unchanged, but viewing
  them still needs a network connection and contacts the image host. Saving or
  cropping one locally requires the host to permit a browser CORS download.
- **Image display size is app metadata.** Width and height survive autosave,
  snapshots and annotated HTML, but CommonMark has no dimension syntax, so a
  plain Markdown reader chooses its own display size. Cropping is portable
  because it changes the exported asset bytes. GIF cropping is disabled to
  avoid silently flattening an animation.
- **Find is literal and case-insensitive.** No regular expressions, no
  whole-word, and a match never spans a block boundary. Cross-document search
  (`⌘⇧F`) is the opposite: stemmed and ranked, so it matches *running* for
  *run* but will not do substrings.
- **Cross-document search stems English and Greek.** Text in other languages is
  still found, but only on the forms actually written — *läuft* will not find
  *laufen*. ZBSearch holds one language per index, so a script-dispatched
  stemmer keeps a single comparable BM25 space rather than splitting into
  per-language indexes whose scores could not be merged honestly.
- **Search results reflect this tab's view of the database.** The index is
  built per tab, so another tab's writes are invisible to it until reload — a
  narrower case of the last-write-wins limitation above.
- **The diff in version history is line-based, over the derived markdown.**
  A reflowed paragraph reads as one line replaced, because it is one line.
- **A table cell holds one line.** GFM has no way to put a line break in a pipe
  cell — the upstream serializer emits a literal `<br>`, which is exactly the
  pollution this project rules out. The schema constrains cells to a single
  paragraph, Enter and Shift-Enter are inert inside a table, and a pasted line
  break becomes a space.
- **A literal `|` typed into a table cell breaks the file.** It is written
  unescaped and splits the cell on the next read. This one is not fixable from
  here: `renderTableToMarkdown` has no render-side escaping at all, and a
  backslash placed in the document is itself escaped on the way out, so no
  document can serialize as `\|`. Fixing it means replacing the upstream table
  serializer. Pinned by tests in `src/test/table-editing.test.ts` so an upstream
  fix is noticed.
- **Table alignment is per column, not per cell.** GFM stores it in the
  delimiter row. Aligning writes every cell in the column in one undoable step,
  so the screen and the file always agree.
- **Turning off a table's header row leaves an empty one in the file.** A GFM
  table must have a header, so a headerless table serializes with an empty
  header row and reads back with one. Idempotent, but not what you left.
- **`zbsearch` and `@zbsearch/stemmers` are pinned exactly.** Both are weeks-old
  forks of Orama on a shared version line, and an unattended patch bump into a
  Workbox-precached offline app is not something you discover until a user's
  search quietly stops matching. `src/test/search-language.test.ts` pins the
  upstream behaviours the index schema depends on, including two the published
  docs get wrong: `groupBy` rejects `enum` properties, and multilingual mode
  does not fold Greek diacritics.
- **`@tiptap/*` versions are pinned exactly.** Their peer deps demand an exact
  match; a caret lets two copies of `@tiptap/core` resolve, which breaks
  ProseMirror plugin identity. Bump them together.

## Layout

```
src/
├── db/          IndexedDB (idb): schema, client, documents, threads, snapshots
├── markdown/    config (allowlists) · export · exportHtml · import · anchors
├── editor/      extensions/ (comment mark, search, plugins) · useMarkdownEditor
├── images/      file/URL validation · durable insertion · crop transforms
├── lib/         fuzzy · highlight · lineDiff · snapshotPolicy · href · stats · time
├── search/      passages · flatten (anchor rule) · store (index) · snippet · stemmer
├── hooks/       useDocuments · useThreads · useGlobalShortcuts · useFileDrop · …
├── components/  AppShell · editor/ · comments/ · documents/ · history/
└── test/        schema-lock · markdown-roundtrip · comment-mark · orphan · db
```

## PWA

`vite-plugin-pwa` with `registerType: 'prompt'` — deliberately not `autoUpdate`,
which reloads the page as soon as a new worker appears and would discard
anything typed since the last autosave. The prompt flushes pending state first
(`usePwaUpdate`). Icons are generated from `public/pwa-source.svg` via
`bun run generate-pwa-assets`, with zero padding — the source tile carries its
own safe area, so a bare-glyph replacement would need the padding restored.

Install it from [markdown.mysolon.gr](https://markdown.mysolon.gr) with the
browser's install action; it then launches in its own window, handles `.md`
files from the OS file manager, and works with the network off.

Storage requests `navigator.storage.persist()` on first use; without it Safari
evicts IndexedDB after 7 days of inactivity.
