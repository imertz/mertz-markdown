import { describe, expect, it } from 'vitest'
import {
  consumeSlashCommand,
  dismissSlashCommand,
  slashCommandAt,
  slashCommandKey,
} from '../editor/extensions/slashCommands'
import { toMarkdown } from '../markdown/export'
import { createTestEditor } from './editorHarness'

describe('slash command state', () => {
  it('opens at a block-leading slash and follows the query', () => {
    const editor = createTestEditor('')
    editor.commands.focus()

    editor.commands.insertContent('/')
    expect(slashCommandKey.getState(editor.state)).toEqual({
      from: 1,
      to: 2,
      query: '',
    })

    editor.commands.insertContent('heading')
    expect(slashCommandKey.getState(editor.state)).toMatchObject({
      from: 1,
      to: 9,
      query: 'heading',
    })

    editor.destroy()
  })

  it('does not treat a slash in prose as a command', () => {
    const editor = createTestEditor('A path / inside prose')
    editor.commands.focus('end')
    editor.commands.insertContent('/')

    expect(slashCommandKey.getState(editor.state)).toBeNull()
    expect(slashCommandAt(editor.state)).toBeNull()

    editor.destroy()
  })

  it('dismisses without changing the typed text', () => {
    const editor = createTestEditor('')
    editor.commands.focus()
    editor.commands.insertContent('/table')

    dismissSlashCommand(editor)

    expect(slashCommandKey.getState(editor.state)).toBeNull()
    expect(toMarkdown(editor).trim()).toBe('/table')

    editor.destroy()
  })

  it('consumes the trigger as one edit and returns its insertion point', () => {
    const editor = createTestEditor('')
    editor.commands.focus()
    editor.commands.insertContent('/table')
    const command = slashCommandKey.getState(editor.state)
    expect(command).not.toBeNull()

    const position = consumeSlashCommand(editor, command!)

    expect(position).toBe(1)
    expect(toMarkdown(editor).trim()).toBe('')
    expect(slashCommandKey.getState(editor.state)).toBeNull()

    editor.destroy()
  })
})
