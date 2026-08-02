import { ResizableNodeView } from '@tiptap/core'
import type { ImageOptions } from '@tiptap/extension-image'
import { Image } from '@tiptap/extension-image'

export interface LocalImageOptions extends ImageOptions {
  resolveAsset: (assetId: string) => Promise<Blob | undefined>
}

const NO_ASSET = async (): Promise<undefined> => undefined

/**
 * Standard Markdown image syntax with one internal-only asset id.
 *
 * `src` always remains the portable `images/name.ext` path. The node view
 * swaps only the DOM's source for a temporary object URL, so an autosave can
 * never accidentally persist a session-bound `blob:` URL.
 */
export const LocalImage = Image.extend<LocalImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
      HTMLAttributes: {},
      resize: false,
      resolveAsset: NO_ASSET,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: element => element.getAttribute('data-local-asset-id'),
        renderHTML: attributes =>
          typeof attributes.assetId === 'string' && attributes.assetId
            ? { 'data-local-asset-id': attributes.assetId }
            : {},
      },
    }
  },

  addNodeView() {
    if (typeof document === 'undefined') return null

    return ({ node, getPos, editor }) => {
      const content = document.createElement('span')
      content.className = 'editor-image'

      const image = document.createElement('img')
      image.draggable = false

      const status = document.createElement('span')
      status.className = 'editor-image__status'
      status.setAttribute('aria-hidden', 'true')

      const caption = document.createElement('div')
      caption.className = 'editor-image__caption'
      content.append(image, status)

      let objectUrl: string | null = null
      let generation = 0
      let sourceKey: string | null = null

      const revoke = () => {
        if (!objectUrl) return
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }

      const setState = (state: 'loading' | 'ready' | 'missing') => {
        content.dataset.state = state
        status.textContent =
          state === 'loading'
            ? 'Loading image…'
            : state === 'missing'
              ? 'Image unavailable'
              : ''
      }

      const sync = async (next: typeof node) => {
        const alt = typeof next.attrs.alt === 'string' ? next.attrs.alt : ''
        const title =
          typeof next.attrs.title === 'string' ? next.attrs.title : ''
        image.alt = alt
        if (title) image.title = title
        else image.removeAttribute('title')
        caption.textContent = title.trim()
        caption.hidden = !title.trim()

        const width =
          typeof next.attrs.width === 'number' && next.attrs.width > 0
            ? next.attrs.width
            : null
        const height =
          typeof next.attrs.height === 'number' && next.attrs.height > 0
            ? next.attrs.height
            : null
        content.style.width = width ? `${width}px` : ''
        content.style.height = height ? `${height}px` : ''
        image.style.width = width ? '100%' : ''
        image.style.height = height ? '100%' : ''
        image.style.maxHeight = width || height ? 'none' : ''

        image.onload = () => setState('ready')
        image.onerror = () => setState('missing')

        const assetId =
          typeof next.attrs.assetId === 'string' ? next.attrs.assetId : ''
        const source = typeof next.attrs.src === 'string' ? next.attrs.src : ''
        const nextSourceKey = assetId ? `asset:${assetId}` : `remote:${source}`
        if (sourceKey === nextSourceKey) return
        sourceKey = nextSourceKey
        const current = (generation += 1)
        revoke()

        if (!assetId) {
          delete content.dataset.assetId
          if (!source) {
            image.removeAttribute('src')
            setState('missing')
            return
          }
          setState('loading')
          image.src = source
          return
        }

        content.dataset.assetId = assetId
        image.removeAttribute('src')
        setState('loading')
        const blob = await this.options.resolveAsset(assetId)
        if (current !== generation) return
        if (!blob) {
          setState('missing')
          return
        }

        objectUrl = URL.createObjectURL(blob)
        image.src = objectUrl
      }

      const resizable = new ResizableNodeView({
        element: content,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          content.style.width = `${Math.round(width)}px`
          content.style.height = `${Math.round(height)}px`
        },
        onCommit: (width, height) => {
          const position = getPos()
          if (position === undefined || editor.isDestroyed) return
          const editorWidth = editor.view.dom.clientWidth || width
          const nextWidth = Math.round(Math.min(width, editorWidth))
          const nextHeight = Math.round(nextWidth * (height / width))
          editor
            .chain()
            .setNodeSelection(position)
            .updateAttributes('image', {
              width: nextWidth,
              height: nextHeight,
            })
            .run()
        },
        onUpdate: updated => {
          if (updated.type !== node.type) return false
          void sync(updated)
          return true
        },
        options: {
          directions: [
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
          ],
          min: { width: 48, height: 8 },
          preserveAspectRatio: true,
          className: {
            container: 'editor-image-resize',
            wrapper: 'editor-image-resize__wrapper',
            handle: 'editor-image-resize__handle',
            resizing: 'is-resizing',
          },
        },
      })
      resizable.dom.append(caption)
      // TipTap 3.29's resizer listens for touchmove but not touchend. Bridge
      // that missing end event so a phone resize commits instead of remaining
      // in its active state indefinitely.
      const resizableTouch = resizable as unknown as {
        handleMouseUp: () => void
        handleTouchMove: (event: TouchEvent) => void
      }
      const finishTouchResize = () => {
        resizableTouch.handleMouseUp()
        document.removeEventListener('touchmove', resizableTouch.handleTouchMove)
      }
      document.addEventListener('touchend', finishTouchResize)
      document.addEventListener('touchcancel', finishTouchResize)

      /*
       * Images remain inline schema nodes so ordinary Markdown such as
       * `Before ![chart](chart.png) after` keeps working. An image at the start
       * of a top-level paragraph is block-like in the editor, which also keeps
       * a caption written on the next source line below it. An image with a
       * caption is block-like wherever it appears; images that follow text
       * without a caption remain inline.
       */
      const syncStandaloneState = () => {
        const position = getPos()
        if (position === undefined) return
        const resolved = editor.state.doc.resolve(position)
        const parent = resolved.parent
        const current = editor.state.doc.nodeAt(position)
        const hasCaption =
          typeof current?.attrs.title === 'string' &&
          current.attrs.title.trim().length > 0
        const standalone =
          resolved.depth === 1 &&
          parent.type.name === 'paragraph' &&
          resolved.index(resolved.depth) === 0 &&
          parent.firstChild?.type === node.type
        resizable.dom.classList.toggle(
          'editor-image-resize--standalone',
          standalone || hasCaption,
        )
        resizable.dom.classList.toggle(
          'editor-image-resize--captioned',
          hasCaption,
        )
      }
      editor.on('transaction', syncStandaloneState)
      syncStandaloneState()

      void sync(node)

      return {
        dom: resizable.dom,
        update: resizable.update.bind(resizable),
        destroy: () => {
          generation += 1
          revoke()
          document.removeEventListener('touchend', finishTouchResize)
          document.removeEventListener('touchcancel', finishTouchResize)
          document.removeEventListener('touchmove', resizableTouch.handleTouchMove)
          editor.off('transaction', syncStandaloneState)
          resizable.destroy()
        },
      }
    }
  },
})
