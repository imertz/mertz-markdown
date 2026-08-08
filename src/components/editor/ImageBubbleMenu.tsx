import type { Editor } from '@tiptap/core'
import type { BubbleMenuPluginProps } from '@tiptap/extension-bubble-menu'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useCallback, useEffect, useState } from 'react'
import { imageMimeTypeForPath } from '../../images/files'
import { TrashIcon } from '../icons'
import { isImageSelection } from './bubbleVisibility'
import { useRepositionOnScroll } from './useRepositionOnScroll'

type ShouldShow = NonNullable<BubbleMenuPluginProps['shouldShow']>

const IMAGE_MENU_KEY = new PluginKey('imageBubbleMenu')

interface ImageBubbleMenuProps {
  editor: Editor
  onCrop?: (position: number) => void
  onLocalize?: (position: number) => void
}

export function ImageBubbleMenu({
  editor,
  onCrop,
  onLocalize,
}: ImageBubbleMenuProps) {
  const shouldShow = useCallback<ShouldShow>(
    ({ view, element, state }) =>
      (view.hasFocus() || element.contains(document.activeElement)) &&
      isImageSelection(state),
    [],
  )

  useRepositionOnScroll(editor, IMAGE_MENU_KEY, '.image-bar')

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={IMAGE_MENU_KEY}
      className="image-bar"
      role="toolbar"
      aria-label="Image"
      shouldShow={shouldShow}
      updateDelay={0}
    >
      <ImageControls
        editor={editor}
        onCrop={onCrop}
        onLocalize={onLocalize}
      />
    </BubbleMenu>
  )
}

/** Exported independently so focus and editing are testable without a portal. */
export function ImageControls({
  editor,
  onCrop,
  onLocalize,
}: ImageBubbleMenuProps) {
  const selected = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const selection = instance.state.selection
      if (
        !(selection instanceof NodeSelection) ||
        selection.node.type.name !== 'image'
      ) {
        return {
          pos: -1,
          alt: '',
          caption: '',
          width: null,
          height: null,
          assetId: null,
          src: '',
        }
      }
      return {
        pos: selection.from,
        alt:
          typeof selection.node.attrs.alt === 'string'
            ? selection.node.attrs.alt
            : '',
        caption:
          typeof selection.node.attrs.caption === 'string'
            ? selection.node.attrs.caption
            : '',
        width:
          typeof selection.node.attrs.width === 'number'
            ? selection.node.attrs.width
            : null,
        height:
          typeof selection.node.attrs.height === 'number'
            ? selection.node.attrs.height
            : null,
        assetId:
          typeof selection.node.attrs.assetId === 'string'
            ? selection.node.attrs.assetId
            : null,
        src:
          typeof selection.node.attrs.src === 'string'
            ? selection.node.attrs.src
            : '',
      }
    },
  })
  const [alt, setAlt] = useState(selected.alt)
  const [caption, setCaption] = useState(selected.caption)
  const [width, setWidth] = useState(
    selected.width === null ? '' : String(Math.round(selected.width)),
  )

  useEffect(() => setAlt(selected.alt), [selected.alt, selected.pos])
  useEffect(
    () => setCaption(selected.caption),
    [selected.caption, selected.pos],
  )
  useEffect(
    () =>
      setWidth(
        selected.width === null ? '' : String(Math.round(selected.width)),
      ),
    [selected.pos, selected.width],
  )

  const commit = () => {
    if (selected.pos < 0 || editor.isDestroyed) return
    editor
      .chain()
      .setNodeSelection(selected.pos)
      .updateAttributes('image', { alt: alt.trim() })
      .run()
  }

  const commitCaption = () => {
    if (selected.pos < 0 || editor.isDestroyed) return
    editor
      .chain()
      .setNodeSelection(selected.pos)
      .updateAttributes('image', { caption: caption.trim() || null })
      .run()
  }

  const ratio = () => {
    if (selected.width && selected.height) {
      return selected.width / selected.height
    }
    const dom = editor.view.nodeDOM(selected.pos)
    const image =
      dom instanceof HTMLImageElement
        ? dom
        : dom instanceof Element
          ? dom.querySelector('img')
          : null
    if (image?.naturalWidth && image.naturalHeight) {
      return image.naturalWidth / image.naturalHeight
    }
    const bounds = image?.getBoundingClientRect()
    return bounds?.width && bounds.height ? bounds.width / bounds.height : null
  }

  const commitWidth = () => {
    if (selected.pos < 0 || editor.isDestroyed) return
    const requested = Number(width)
    const aspect = ratio()
    if (!Number.isFinite(requested) || requested <= 0 || !aspect) {
      setWidth(selected.width === null ? '' : String(selected.width))
      return
    }
    const editorWidth = editor.view.dom.clientWidth || requested
    const nextWidth = Math.round(Math.min(Math.max(48, requested), editorWidth))
    const nextHeight = Math.round(nextWidth / aspect)
    setWidth(String(nextWidth))
    editor
      .chain()
      .setNodeSelection(selected.pos)
      .updateAttributes('image', {
        width: nextWidth,
        height: nextHeight,
      })
      .run()
  }

  const localGif =
    selected.assetId !== null &&
    imageMimeTypeForPath(selected.src) === 'image/gif'

  return (
    <>
      <label className="image-bar__label">
        <span>Alt text</span>
        <input
          type="text"
          value={alt}
          placeholder="Describe the image"
          onChange={event => setAlt(event.target.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              editor.commands.focus()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setAlt(selected.alt)
              editor.commands.focus()
            }
          }}
        />
      </label>
      <label className="image-bar__label">
        <span>Caption</span>
        <input
          type="text"
          value={caption}
          placeholder="Optional caption"
          onChange={event => setCaption(event.target.value)}
          onBlur={commitCaption}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitCaption()
              editor.commands.focus()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setCaption(selected.caption)
              editor.commands.focus()
            }
          }}
        />
      </label>
      <label className="image-bar__size">
        <span>Width</span>
        <input
          type="number"
          min={48}
          step={1}
          inputMode="numeric"
          value={width}
          placeholder="Natural"
          aria-label="Image width in pixels"
          onChange={event => setWidth(event.target.value)}
          onBlur={commitWidth}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitWidth()
              editor.commands.focus()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setWidth(
                selected.width === null ? '' : String(selected.width),
              )
              editor.commands.focus()
            }
          }}
        />
        <span>px</span>
      </label>
      <button
        type="button"
        className="image-bar__text-button"
        disabled={selected.width === null}
        onClick={() => {
          if (selected.pos < 0) return
          setWidth('')
          editor
            .chain()
            .focus()
            .setNodeSelection(selected.pos)
            .updateAttributes('image', { width: null, height: null })
            .run()
        }}
      >
        Natural
      </button>
      <button
        type="button"
        className="image-bar__text-button"
        disabled={!onCrop || localGif}
        title={
          localGif
            ? 'GIF cropping is disabled to preserve animation'
            : 'Crop image'
        }
        onClick={() => {
          if (selected.pos >= 0) onCrop?.(selected.pos)
        }}
      >
        Crop
      </button>
      {selected.assetId === null ? (
        <button
          type="button"
          className="image-bar__text-button"
          disabled={!onLocalize}
          title="Save this remote image in browser storage"
          onClick={() => {
            if (selected.pos >= 0) onLocalize?.(selected.pos)
          }}
        >
          Save locally
        </button>
      ) : null}
      <button
        type="button"
        className="image-bar__delete"
        aria-label="Delete image"
        title="Delete image"
        onClick={() => {
          if (selected.pos < 0) return
          editor
            .chain()
            .focus()
            .setNodeSelection(selected.pos)
            .deleteSelection()
            .run()
        }}
      >
        <TrashIcon />
      </button>
    </>
  )
}
