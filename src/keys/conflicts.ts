import { useEffect } from 'react'
import { aliasesFor, type CommandId } from './catalog'
import { chordSignature, parseChord } from './chord'
import type { Command, CommandContext } from './context'
import { isLive } from './context'
import { chordOf } from './registry'

export interface Conflict {
  signature: string
  spec: string
  ids: string[]
}

/**
 * Two commands that would both answer to one key, right now.
 *
 * "Right now" is the whole subtlety: a table command and a formatting command
 * may share a chord quite legitimately, because their `when` predicates are
 * disjoint and only one of them is ever live. Comparing the static catalog
 * would flag those; comparing what the matcher would actually see does not.
 */
export function findConflicts(
  commands: readonly Command[],
  context: CommandContext,
  apple: boolean,
): Conflict[] {
  const claimed = new Map<string, { spec: string; ids: string[] }>()

  for (const command of commands) {
    if (!isLive(command, context)) continue

    const specs = [
      chordOf(command, apple),
      // Aliases count. An unadvertised chord that runs the wrong command is
      // still the wrong command.
      ...(command.id.includes(':')
        ? []
        : aliasesFor(command.id as CommandId, apple)),
    ]

    for (const spec of specs) {
      if (!spec) continue
      const signature = chordSignature(parseChord(spec))
      const entry = claimed.get(signature)
      if (entry) entry.ids.push(command.id)
      else claimed.set(signature, { spec, ids: [command.id] })
    }
  }

  return [...claimed.entries()]
    .filter(([, entry]) => entry.ids.length > 1)
    .map(([signature, entry]) => ({ signature, spec: entry.spec, ids: entry.ids }))
}

/**
 * Fail loudly, in development, the moment two commands claim one chord.
 *
 * Throws rather than logs. A `console.error` is something you scroll past while
 * chasing something else; Vite's error overlay is not, and this can only ever
 * fire on a developer's own machine — the check compiles out of a production
 * build entirely.
 */
export function useConflictAssertion(
  commands: readonly Command[],
  context: CommandContext,
  apple: boolean,
): void {
  // A cheap string that changes exactly when the live set or its chords change,
  // so the real comparison runs on a keystroke-free path.
  const fingerprint = commands
    .filter(command => isLive(command, context))
    .map(command => `${command.id}@${chordOf(command, apple)}`)
    .join('|')

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const conflicts = findConflicts(commands, context, apple)
    if (!conflicts.length) return

    const detail = conflicts
      .map(({ spec, ids }) => `  ${spec} → ${ids.join(', ')}`)
      .join('\n')
    throw new Error(
      `Two commands claim the same shortcut:\n${detail}\n` +
        'Give one of them a different chord in src/keys/catalog.ts.',
    )
    // The fingerprint is the real dependency; the arrays it summarises are
    // rebuilt every render and would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])
}
