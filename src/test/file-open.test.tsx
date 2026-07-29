import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFileDrop } from '../hooks/useFileDrop'
import { useFileLaunch } from '../hooks/useFileLaunch'
import { isMarkdownFile } from '../markdown/import'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'launchQueue')
})

const dragEvent = (type: string, files: File[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  })
  return event
}

describe('isMarkdownFile', () => {
  it('accepts every extension the file picker does', () => {
    for (const name of ['a.md', 'b.markdown', 'c.mdown', 'd.mkd', 'E.MD']) {
      expect(isMarkdownFile(new File([''], name))).toBe(true)
    }
  })

  it('accepts a declared markdown MIME even without the extension', () => {
    expect(
      isMarkdownFile(new File([''], 'notes', { type: 'text/markdown' })),
    ).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isMarkdownFile(new File([''], 'photo.png'))).toBe(false)
    expect(isMarkdownFile(new File([''], 'readme.txt'))).toBe(false)
  })
})

describe('useFileLaunch', () => {
  it('opens the files the OS hands over', async () => {
    let consumer: ((params: LaunchParams) => void) | null = null
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer: (fn: (params: LaunchParams) => void) => {
          consumer = fn
        },
      },
    })

    const onImport = vi.fn()
    renderHook(() => useFileLaunch(onImport))
    expect(consumer).not.toBeNull()

    const file = new File(['# Handed over'], 'handed-over.md')
    consumer!({
      files: [{ getFile: async () => file } as FileSystemFileHandle],
    })

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file))
  })

  it('does nothing where the API is absent', () => {
    // Every browser but Chromium, today.
    expect(() => renderHook(() => useFileLaunch(vi.fn()))).not.toThrow()
  })
})

describe('useFileDrop', () => {
  it('reports a file drag entering and leaving the window', () => {
    const { result } = renderHook(() => useFileDrop(vi.fn()))
    expect(result.current).toBe(false)

    act(() => window.dispatchEvent(dragEvent('dragenter', [])))
    expect(result.current).toBe(true)

    act(() => window.dispatchEvent(dragEvent('dragleave', [])))
    expect(result.current).toBe(false)
  })

  it('stays on until the last of the nested dragleaves', () => {
    // dragenter/dragleave fire per element crossed, so a drag over the editor
    // inside the workspace inside the body raises several of each.
    const { result } = renderHook(() => useFileDrop(vi.fn()))

    act(() => window.dispatchEvent(dragEvent('dragenter', [])))
    act(() => window.dispatchEvent(dragEvent('dragenter', [])))
    act(() => window.dispatchEvent(dragEvent('dragleave', [])))
    expect(result.current).toBe(true)

    act(() => window.dispatchEvent(dragEvent('dragleave', [])))
    expect(result.current).toBe(false)
  })

  it('imports the markdown files that were dropped and skips the rest', async () => {
    const onImport = vi.fn()
    const { result } = renderHook(() => useFileDrop(onImport))

    const markdown = new File(['# Notes'], 'notes.md')
    const dropped = dragEvent('drop', [
      markdown,
      new File(['binary'], 'photo.png'),
    ])

    act(() => window.dispatchEvent(dragEvent('dragenter', [])))
    act(() => window.dispatchEvent(dropped))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport).toHaveBeenCalledWith(markdown)
    expect(result.current).toBe(false)
  })

  it('cancels the drop so the browser does not navigate to the file', () => {
    renderHook(() => useFileDrop(vi.fn()))

    const event = dragEvent('dragover', [])
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets an image dropped on the editor reach the editor file handler', () => {
    const onImport = vi.fn()
    renderHook(() => useFileDrop(onImport))
    const editor = document.createElement('div')
    editor.className = 'ProseMirror'
    document.body.append(editor)

    const event = dragEvent('drop', [
      new File(['image'], 'photo.png', { type: 'image/png' }),
    ])
    editor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onImport).not.toHaveBeenCalled()
    editor.remove()
  })

  it('ignores drags that carry no files, so editor drag-and-drop still works', () => {
    const onImport = vi.fn()
    const { result } = renderHook(() => useFileDrop(onImport))

    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(result.current).toBe(false)
  })
})
