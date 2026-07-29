import { getMarkRange } from '@tiptap/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkPopover } from '../components/editor/LinkPopover'
import { normalizeHref } from '../lib/href'
import { toMarkdown } from '../markdown/export'
import { createTestEditor, rangeOfText } from './editorHarness'

afterEach(cleanup)

describe('normalizeHref', () => {
  it('assumes https for a bare host', () => {
    expect(normalizeHref('example.com/docs')).toBe('https://example.com/docs')
  })

  it('leaves anything that already declares a scheme alone', () => {
    expect(normalizeHref('http://x.dev')).toBe('http://x.dev')
    expect(normalizeHref('mailto:a@b.dev')).toBe('mailto:a@b.dev')
    expect(normalizeHref('tel:+301234')).toBe('tel:+301234')
  })

  it('leaves in-page and site-relative targets alone', () => {
    expect(normalizeHref('#summary')).toBe('#summary')
    expect(normalizeHref('/guide')).toBe('/guide')
  })

  it('turns a bare address into a mailto', () => {
    expect(normalizeHref('someone@example.com')).toBe(
      'mailto:someone@example.com',
    )
  })

  it('refuses schemes that execute instead of navigating', () => {
    // A link mark carrying one of these is a script the document runs on click.
    expect(normalizeHref('javascript:alert(1)')).toBe('')
    expect(normalizeHref('  JavaScript:alert(1)')).toBe('')
    expect(normalizeHref('data:text/html,<script>')).toBe('')
  })

  it('treats whitespace as nothing at all', () => {
    expect(normalizeHref('   ')).toBe('')
  })
})

const setup = (
  markdown: string,
  needle: string,
  href = '',
) => {
  const editor = createTestEditor(markdown)
  const range = rangeOfText(editor, needle)
  const onClose = vi.fn()
  render(
    <LinkPopover
      editor={editor}
      target={{ ...range, href }}
      onClose={onClose}
    />,
  )
  return { editor, onClose, user: userEvent.setup() }
}

const input = () => screen.getByLabelText('Link address') as HTMLInputElement

describe('LinkPopover', () => {
  it('takes focus without losing the range it was opened on', async () => {
    const { user, editor } = setup('link this phrase please', 'this phrase')
    expect(document.activeElement).toBe(input())

    await user.keyboard('example.com')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // The captured range survived the focus moving into the popover, which is
    // the whole reason the range is passed in rather than read on submit.
    expect(toMarkdown(editor)).toContain('[this phrase](https://example.com)')
  })

  it('applies on Enter', async () => {
    const { user, editor } = setup('one word here', 'word')

    await user.keyboard('docs.dev{Enter}')
    expect(toMarkdown(editor)).toContain('[word](https://docs.dev)')
  })

  it('prefills an existing href and rewrites the whole link', async () => {
    const editor = createTestEditor('see [the docs](https://old.dev) now')
    const type = editor.schema.marks.link
    const at = rangeOfText(editor, 'docs')
    const range = getMarkRange(editor.state.doc.resolve(at.from), type)
    expect(range).toBeDefined()

    render(
      <LinkPopover
        editor={editor}
        target={{ ...range!, href: 'https://old.dev' }}
        onClose={vi.fn()}
      />,
    )
    expect(input().value).toBe('https://old.dev')

    const user = userEvent.setup()
    await user.clear(input())
    await user.keyboard('https://new.dev{Enter}')

    const markdown = toMarkdown(editor)
    expect(markdown).toContain('[the docs](https://new.dev)')
    expect(markdown).not.toContain('old.dev')
  })

  it('removes a link without touching its text', async () => {
    const editor = createTestEditor('see [the docs](https://old.dev) now')
    const at = rangeOfText(editor, 'docs')
    const range = getMarkRange(
      editor.state.doc.resolve(at.from),
      editor.schema.marks.link,
    )

    render(
      <LinkPopover
        editor={editor}
        target={{ ...range!, href: 'https://old.dev' }}
        onClose={vi.fn()}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }))

    const markdown = toMarkdown(editor)
    expect(markdown).not.toContain('old.dev')
    expect(markdown).toContain('the docs')
  })

  it('offers no Remove button when there is no link yet', () => {
    setup('plain text', 'plain')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('disables Apply for input it will not write', async () => {
    const { user } = setup('some text', 'some')
    const apply = () =>
      screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement

    expect(apply().disabled).toBe(true)

    await user.keyboard('javascript:alert(1)')
    expect(apply().disabled).toBe(true)

    await user.clear(input())
    await user.keyboard('fine.dev')
    expect(apply().disabled).toBe(false)
  })
})
