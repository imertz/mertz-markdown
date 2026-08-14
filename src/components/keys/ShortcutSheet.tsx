import { useMemo, useState } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import type { CategoryId, CommandId } from '../../keys/catalog'
import { CATEGORIES, noteFor } from '../../keys/catalog'
import type { Command, CommandContext } from '../../keys/context'
import { isLive } from '../../keys/context'
import { hintOf } from '../../keys/registry'
import { REPO_NAME, REPO_URL } from '../../lib/repo'
import { isApplePlatform } from '../../lib/shortcuts'
import { ExternalLinkIcon } from '../icons'

interface ShortcutSheetProps {
  commands: readonly Command[]
  context: CommandContext
  onClose: () => void
}

interface Row {
  id: string
  label: string
  hint: string
  note?: string
  live: boolean
}

interface Group {
  id: CategoryId
  label: string
  inactiveNote?: string
  rows: Row[]
  /** Whether anything in the group applies right now. */
  live: boolean
}

/**
 * Every shortcut in the app, on one page.
 *
 * Generated from the registry rather than written out, which is the only reason
 * it can be trusted: a chord that changes in the catalog changes here in the
 * same commit, and commands Tiptap delivers — ⌘B, ⌘Z, Tab between table cells —
 * appear alongside the app's own instead of being folklore.
 *
 * Context-gated groups are shown rather than hidden. "Table commands exist, and
 * they need the cursor in a table" is more useful than an absence the reader
 * has to notice.
 */
export function ShortcutSheet({
  commands,
  context,
  onClose,
}: ShortcutSheetProps) {
  const [query, setQuery] = useState('')
  const container = useDismissable<HTMLDivElement>(true, onClose)
  const apple = isApplePlatform()

  const groups = useMemo<Group[]>(() => {
    const trimmed = query.trim().toLowerCase()

    return CATEGORIES.map(category => {
      const rows: Row[] = commands
        .filter(command => command.category === category.id)
        // Only what a reader can act on. The per-document jumps are covered by
        // one row from the catalog rather than nine identical-looking ones.
        .filter(command => !command.id.includes(':'))
        .map(command => ({
          id: command.id,
          label: command.label,
          hint: hintOf(command, apple),
          note: noteFor(command.id as CommandId, apple),
          live: isLive(command, context),
        }))
        .filter(row => row.hint || row.note)
        .filter(
          row =>
            !trimmed ||
            row.label.toLowerCase().includes(trimmed) ||
            row.hint.toLowerCase().includes(trimmed),
        )

      return {
        ...category,
        rows,
        live: rows.some(row => row.live),
      }
    }).filter(group => group.rows.length > 0)
  }, [commands, context, query, apple])

  return (
    <div className="palette-backdrop">
      <div
        className="sheet"
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-keys="overlay"
      >
        <div className="sheet__head">
          <h2 className="sheet__title">Keyboard shortcuts</h2>
          <input
            type="text"
            className="sheet__input"
            value={query}
            placeholder="Filter…"
            aria-label="Filter shortcuts"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={event => setQuery(event.target.value)}
          />
        </div>

        <div className="sheet__body">
          {groups.map(group => (
            <section
              key={group.id}
              className={`sheet__group${group.live ? '' : ' sheet__group--inactive'}`}
            >
              <h3 className="sheet__group-title">
                {group.label}
                {!group.live && group.inactiveNote ? (
                  <span className="sheet__badge">{group.inactiveNote}</span>
                ) : null}
              </h3>

              <dl className="sheet__rows">
                {group.rows.map(row => (
                  <div key={row.id} className="sheet__row">
                    <dt className="sheet__label">
                      {row.label}
                      {row.note ? (
                        <span className="sheet__note">{row.note}</span>
                      ) : null}
                    </dt>
                    <dd className="sheet__keys">
                      {row.hint ? <kbd className="kbd">{row.hint}</kbd> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {groups.length === 0 ? (
            <p className="sheet__empty">No matching shortcuts</p>
          ) : null}
        </div>

        {/*
          Outside the scrolling body, so it stays put rather than sitting at the
          bottom of a long list nobody scrolls to. This is the app's only
          informational overlay, which makes it the closest thing there is to an
          About box — hence the name of the thing alongside the link.
        */}
        <div className="sheet__foot">
          <span className="sheet__foot-name">{REPO_NAME}</span>
          <a
            className="sheet__foot-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
            <ExternalLinkIcon className="sheet__foot-icon" />
          </a>
        </div>
      </div>
    </div>
  )
}
