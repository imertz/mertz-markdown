import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/**
 * Mermaid diagrams, rendered from the fenced code block that already holds
 * them.
 *
 * ` ```mermaid ` is not an extension to the dialect — it is an ordinary
 * info-string on an ordinary GFM fence, which is exactly how GitHub, GitLab
 * and every other renderer that draws these has agreed to spell it. So the
 * feature needs no node, no mark and no entry in markdown/config.ts: the
 * document already *is* the diagram, and this file only draws it.
 *
 * Everything here is decorations, for the same reason highlighting is. The
 * rendered SVG is a widget beside the block and the collapse is a class on it;
 * neither reaches the document, so ⌘Z never undoes a *render*, an autosave
 * triggered by one is impossible, and the `.md` is unchanged in both
 * directions. `src/test/mermaid.test.ts` pins all three.
 */

/** The info string that turns a fence into a diagram. */
export const MERMAID_LANGUAGE = 'mermaid'

export const mermaidKey = new PluginKey<MermaidPluginState>('mermaid')

/** On the `pre`, whatever the render is doing. */
export const MERMAID_SOURCE_CLASS = 'mermaid-source'
/** On the `pre`, once there is a diagram standing in for it. */
export const MERMAID_RENDERED_CLASS = 'is-mermaid-rendered'
/** On the `pre`, while the caret is inside it and the source must be legible. */
export const MERMAID_EDITING_CLASS = 'is-mermaid-editing'

export type MermaidTheme = 'light' | 'dark'

type Render =
  | { status: 'pending' }
  | { status: 'ready'; svg: string }
  | { status: 'failed'; message: string }

/**
 * Renders are a pure function of source text and theme, so they are cached at
 * module scope rather than in plugin state: two editors, or the same document
 * reopened, reuse the work. Capped because a diagram is re-rendered on every
 * keystroke that settles, so an afternoon of editing would otherwise retain
 * every intermediate draft of every diagram.
 */
const CACHE_LIMIT = 64
const cache = new Map<string, Render>()

const cacheKey = (theme: MermaidTheme, source: string): string =>
  `${theme}\n${source}`

function remember(key: string, render: Render): void {
  cache.delete(key)
  cache.set(key, render)
  // Map iterates in insertion order, so the first key is the oldest.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** Live views, so a render that lands late can ask them to redraw. */
const views = new Set<EditorView>()

/**
 * Ask every view actually showing this diagram to redraw, and no others.
 *
 * The narrowing is not micro-optimisation. A redraw is a transaction, and a
 * transaction with no document change still runs every appendTransaction in
 * the schema — so a view with no stake in this render should not be handed
 * one at all.
 */
function redraw(source: string): void {
  for (const view of views) {
    if (view.isDestroyed) continue
    const shows = mermaidBlocks(view.state).some(
      block => block.source.trim() === source,
    )
    if (!shows) continue
    view.dispatch(view.state.tr.setMeta(mermaidKey, RERENDER))
  }
}

/** Meta payload asking the plugin to rebuild against the current cache. */
const RERENDER = Symbol('mermaid:rerender')

/* -------------------------------------------------------------------------
 * Loading and rendering
 * ---------------------------------------------------------------------- */

/**
 * `mermaid` is imported dynamically and never at startup.
 *
 * It is by a wide margin the largest thing this app can depend on — several
 * times the size of the entire editor — and most documents contain no diagram
 * at all. Vite splits it into its own chunk, `vite.config.ts` keeps that chunk
 * out of the service worker's precache, and a runtime rule caches it once
 * someone has actually opened a diagram. So the install stays the size it was,
 * and a reader who has drawn one diagram has them offline from then on.
 */
let mermaidModule: Promise<typeof import('mermaid').default> | null = null

function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidModule ??= import('mermaid').then(module => module.default)
  return mermaidModule
}

/** Unique per render: mermaid scopes the SVG's own CSS by this id. */
let renderCounter = 0

/**
 * The app's own palette, handed to mermaid.
 *
 * A diagram is part of the document, not a screenshot pasted into it, so it is
 * drawn in the same greys and the same one accent as everything around it.
 * `base` is the only mermaid theme that takes instruction; the others compute
 * a palette of their own and ignore what they are given.
 *
 * Literals rather than getComputedStyle, for the reason exportHtml.ts repeats
 * its palette too: a render is not always for the screen it is on. The HTML
 * export draws diagrams for a *file*, which has no live stylesheet to read and
 * whose theme is decided by whoever opens it — so the theme has to be an
 * argument all the way down rather than something inferred from the DOM.
 */
const PALETTE: Record<MermaidTheme, Record<string, string>> = {
  light: {
    background: '#f7f6f4',
    primaryColor: '#eeedea',
    primaryTextColor: '#171716',
    primaryBorderColor: '#dedcd8',
    secondaryColor: '#fdf0ea',
    tertiaryColor: '#ffffff',
    lineColor: '#6b6a67',
    textColor: '#171716',
    mainBkg: '#eeedea',
    nodeBorder: '#dedcd8',
  },
  dark: {
    background: '#171716',
    primaryColor: '#212120',
    primaryTextColor: '#f4f3f1',
    primaryBorderColor: '#333331',
    secondaryColor: '#33221a',
    tertiaryColor: '#1f1f1e',
    lineColor: '#a3a29e',
    textColor: '#f4f3f1',
    mainBkg: '#212120',
    nodeBorder: '#333331',
  },
}

const themeVariables = (theme: MermaidTheme): Record<string, string> => ({
  ...PALETTE[theme],
  fontFamily: "'Inter Variable', system-ui, 'Segoe UI', Roboto, sans-serif",
  fontSize: '14px',
})

/**
 * Render one diagram to an SVG string.
 *
 * `securityLevel: 'strict'` is not a default worth inheriting silently: a
 * document can arrive from an import, a paste or an encrypted sync from
 * another device, so its diagrams are untrusted input. Strict runs every label
 * through mermaid's sanitiser and refuses `click` interaction directives
 * outright, which is the only reason it is safe to put the result in the page
 * as markup.
 */
export async function renderMermaid(
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const mermaid = await loadMermaid()
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(theme),
    /*
     * Not optional. Mermaid's default on a parse error is to draw a full-page
     * "Syntax error in text" placard — complete with a cartoon bomb — into
     * document.body, *and then* throw. In a page that is not mermaid's own
     * that means a stack of them piling up behind the app while someone types
     * a diagram, because a half-written arrow is a parse error and every one
     * of them leaves a placard behind.
     *
     * Suppressed, `render` does the one thing it is being asked for: return
     * an SVG or throw. The failure is reported where it belongs — under the
     * block that caused it.
     */
    suppressErrorRendering: true,
    flowchart: { useMaxWidth: true },
  })

  renderCounter += 1
  const { svg } = await mermaid.render(`mermaid-render-${renderCounter}`, source)
  return svg
}

/**
 * Diagrams are rendered a beat after typing stops, not on every keystroke.
 *
 * Mermaid parses and lays out the whole graph on each call, and a half-typed
 * arrow is a syntax error, so rendering eagerly would both cost the most and
 * spend it flashing an error message at someone mid-word.
 */
const RENDER_DELAY_MS = 300

const queue = new Map<string, { source: string; theme: MermaidTheme }>()
let timer: ReturnType<typeof setTimeout> | null = null

function flushQueue(): void {
  timer = null
  const pending = [...queue]
  queue.clear()

  for (const [key, { source, theme }] of pending) {
    renderMermaid(source, theme).then(
      svg => {
        remember(key, { status: 'ready', svg })
        redraw(source)
      },
      error => {
        remember(key, { status: 'failed', message: messageOf(error) })
        redraw(source)
      },
    )
  }
}

function messageOf(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'This diagram could not be drawn'
  /*
   * Mermaid's parse errors arrive as a multi-line dump: a sentence, then the
   * offending line, then a caret under the offending character, then a list of
   * every token the grammar would have accepted instead. Only the sentence is
   * worth showing — the source it quotes is already on screen directly above,
   * and the token list is the grammar's vocabulary rather than the writer's.
   *
   * The trailing colon goes with the rest of the dump it was introducing.
   */
  const first = raw.split('\n')[0]?.trim().replace(/:$/, '')
  return first || 'This diagram could not be drawn'
}

function schedule(key: string, source: string, theme: MermaidTheme): void {
  queue.set(key, { source, theme })
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flushQueue, RENDER_DELAY_MS)
}

/** Test seam: forget every rendered diagram and every queued render. */
export function resetMermaidCache(): void {
  cache.clear()
  queue.clear()
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/* -------------------------------------------------------------------------
 * Inserting one
 * ---------------------------------------------------------------------- */

/**
 * What a new diagram starts as.
 *
 * A working three-node flowchart rather than an empty fence: mermaid has a
 * syntax per diagram type and no discoverable one, so an empty block is a
 * prompt to go and read a manual. This one draws immediately and shows the
 * shape of an edge, which is the only thing you need to know to change it into
 * something else.
 */
export const MERMAID_STARTER = 'flowchart TD\n  A[Start] --> B[Then] --> C[Done]'

/** Insert a starter diagram, optionally at a position rather than the caret. */
export function insertMermaidBlock(editor: Editor, position?: number): void {
  const chain = editor.chain().focus()
  if (position !== undefined) chain.setTextSelection(position)
  chain
    .insertContent({
      type: 'codeBlock',
      attrs: { language: MERMAID_LANGUAGE },
      content: [{ type: 'text', text: MERMAID_STARTER }],
    })
    .run()
}

/* -------------------------------------------------------------------------
 * Decorations
 * ---------------------------------------------------------------------- */

export interface MermaidBlock {
  /** Position of the code block itself. */
  pos: number
  /** Its source text, exactly as the fence holds it. */
  source: string
  /** The caret is inside this block, so its source must stay legible. */
  editing: boolean
}

const currentTheme = (): MermaidTheme =>
  typeof document !== 'undefined' &&
  document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light'

/**
 * Every mermaid fence in the document, and whether the caret is in it.
 *
 * "Editing" is deliberately the caret's own parent rather than any overlap
 * with the selection: ⌘A covers every block in the document, and expanding
 * every diagram in it back into source is not what select-all means.
 */
export function mermaidBlocks(state: EditorState): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  const { $head } = state.selection
  const caretBlock =
    $head.parent.type.name === 'codeBlock' ? $head.before() : null

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return
    if (node.attrs.language !== MERMAID_LANGUAGE) return
    blocks.push({ pos, source: node.textContent, editing: caretBlock === pos })
  })

  return blocks
}

interface MermaidPluginState {
  decorations: DecorationSet
}

function diagramWidget(
  render: Extract<Render, { status: 'ready' | 'failed' }>,
  getPos: () => number | undefined,
  view: EditorView,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'mermaid-diagram'
  container.contentEditable = 'false'

  if (render.status === 'ready') {
    // Safe as markup because mermaid rendered it under securityLevel 'strict',
    // which is the whole reason renderMermaid pins that setting.
    container.innerHTML = render.svg
    container.setAttribute('role', 'img')
  } else {
    container.classList.add('mermaid-diagram--error')
    const message = document.createElement('p')
    message.className = 'mermaid-diagram__message'
    message.textContent = render.message
    container.append(message)
  }

  /*
   * The diagram is how you get back to the source. With the fence collapsed
   * there is nothing else to aim at, and a picture you cannot click into is a
   * dead end — so a press puts the caret in the block, which expands it.
   *
   * mousedown rather than click: ProseMirror has already decided what the
   * press meant by the time a click fires.
   */
  container.addEventListener('mousedown', event => {
    const pos = getPos()
    if (pos === undefined) return
    event.preventDefault()
    const inside = view.state.doc.resolve(pos + 1)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(inside)))
    view.focus()
  })

  return container
}

function build(state: EditorState, view: EditorView | null): DecorationSet {
  const theme = currentTheme()
  const decorations: Decoration[] = []

  for (const block of mermaidBlocks(state)) {
    const node = state.doc.nodeAt(block.pos)
    if (!node) continue

    const source = block.source.trim()
    const key = cacheKey(theme, source)
    let render: Render | undefined = source ? cache.get(key) : undefined
    let drawn = key

    if (source && !render) {
      remember(key, { status: 'pending' })
      schedule(key, source, theme)

      /*
       * Toggling the theme invalidates every diagram at once, because the
       * palette is drawn into the SVG. Rather than dropping the whole document
       * back to source for the length of a redraw, the previous theme's
       * drawing holds the space: the same diagram, in the colours of the theme
       * that has just been left, for about as long as it takes to blink.
       */
      const other = cacheKey(theme === 'dark' ? 'light' : 'dark', source)
      const stale = cache.get(other)
      if (stale?.status === 'ready') {
        render = stale
        drawn = other
      }
    }

    const classes = [MERMAID_SOURCE_CLASS]
    // Only a *drawn* diagram may stand in for the fence. A block that is
    // blank, still rendering or broken keeps its source on screen — otherwise
    // the first three seconds of writing a diagram happen in an invisible
    // block, and a typo makes one disappear.
    if (render?.status === 'ready') classes.push(MERMAID_RENDERED_CLASS)
    if (block.editing) classes.push(MERMAID_EDITING_CLASS)

    decorations.push(
      Decoration.node(block.pos, block.pos + node.nodeSize, {
        class: classes.join(' '),
      }),
    )

    if (!render || render.status === 'pending' || !view) continue

    decorations.push(
      Decoration.widget(
        block.pos,
        (widgetView, getPos) => diagramWidget(render, getPos, widgetView),
        {
          // Before the fence, so revealing the source pushes the source down
          // rather than shifting the picture the reader is looking at.
          side: -1,
          // Keyed by what was drawn, so an unchanged diagram keeps its DOM
          // across every unrelated transaction instead of being re-parsed.
          key: `mermaid:${render.status}:${drawn}`,
          ignoreSelection: true,
        },
      ),
    )
  }

  return DecorationSet.create(state.doc, decorations)
}

/**
 * A collapsed fence has no height, so the browser's own caret motion steps
 * straight over it and a keyboard user can never reach the source.
 *
 * ProseMirror asks the browser where a textblock ends — `endOfTextblock` — so
 * this only fires on the keystroke that was already leaving the current block,
 * and only when the block it would land in is a collapsed diagram. Everything
 * else falls through to the browser, which is better at this than we are.
 */
function enterCollapsedBlock(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false
  }

  const { state } = view
  const { selection } = state
  if (!selection.empty) return false

  const down = event.key === 'ArrowDown'
  try {
    if (!view.endOfTextblock(down ? 'down' : 'up')) return false
  } catch {
    // No layout to ask — a detached editor in a test, for one. Leave the
    // keystroke to the default handler.
    return false
  }

  const collapsed = new Set(
    mermaidBlocks(state)
      .filter(block => !block.editing)
      .map(block => block.pos),
  )
  if (!collapsed.size) return false

  const $head = selection.$head
  if ($head.depth === 0) return false

  // The top-level sibling the keystroke is heading for.
  const start = $head.before(1)
  const previous = state.doc.resolve(start).nodeBefore
  const pos = down ? $head.after(1) : previous ? start - previous.nodeSize : -1
  if (!collapsed.has(pos)) return false

  const node = state.doc.nodeAt(pos)
  if (!node) return false

  // Into the top of the fence going down, the bottom of it coming up — the
  // edge the caret would have arrived at had the block been visible.
  const edge = state.doc.resolve(down ? pos + 1 : pos + node.nodeSize - 1)

  event.preventDefault()
  view.dispatch(
    state.tr.setSelection(TextSelection.near(edge, down ? 1 : -1)).scrollIntoView(),
  )
  return true
}

/**
 * Diagrams are drawn in the app's own palette, so a theme change invalidates
 * every one of them. The observer is the plugin's, not a hook's, because the
 * cache and the decorations are here and React never sees either.
 */
function watchTheme(view: EditorView): () => void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
    return () => {}
  }

  const observer = new MutationObserver(() => {
    if (view.isDestroyed) return
    view.dispatch(view.state.tr.setMeta(mermaidKey, RERENDER))
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

export const Mermaid = Extension.create({
  name: 'mermaid',

  addProseMirrorPlugins() {
    let currentView: EditorView | null = null

    return [
      new Plugin<MermaidPluginState>({
        key: mermaidKey,

        state: {
          init: (_config, state) => ({
            decorations: build(state, currentView),
          }),
          apply(tr, value, _oldState, newState) {
            // A pure remap is enough only when nothing this plugin reads has
            // moved: not the text, not which block the caret is in, and not
            // the cache behind a render that has just landed.
            const rebuild =
              tr.docChanged ||
              tr.selectionSet ||
              tr.getMeta(mermaidKey) === RERENDER
            if (!rebuild) {
              return {
                decorations: value.decorations.map(tr.mapping, tr.doc),
              }
            }
            return { decorations: build(newState, currentView) }
          },
        },

        view(view) {
          currentView = view
          views.add(view)
          const unwatch = watchTheme(view)
          /*
           * The first build ran before there was a view to hand widgets, so a
           * document that opens with a diagram already drawn — a cached one,
           * or a second editor on the same document — would show none until
           * something else moved.
           *
           * Only when there is in fact a fence to draw. A transaction into a
           * document with no diagram in it is a transaction that could only
           * ever cost something.
           */
          queueMicrotask(() => {
            if (view.isDestroyed) return
            if (!mermaidBlocks(view.state).length) return
            view.dispatch(view.state.tr.setMeta(mermaidKey, RERENDER))
          })
          return {
            destroy() {
              unwatch()
              views.delete(view)
              currentView = null
            },
          }
        },

        props: {
          decorations(state) {
            return mermaidKey.getState(state)?.decorations ?? DecorationSet.empty
          },
          handleKeyDown: enterCollapsedBlock,
        },
      }),
    ]
  },
})
