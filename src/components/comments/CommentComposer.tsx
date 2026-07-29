import { useEffect, useRef, useState } from 'react'

interface CommentComposerProps {
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
  /**
   * Focus without letting the browser scroll the composer into view.
   *
   * Set by the draft card, which is positioned by the sidebar's layout pass —
   * that runs in a layout effect, and React may flush this passive effect
   * first, so at focus time the card can still be sitting at its unpositioned
   * static offset (the top of the rail). The browser would then scroll the
   * whole workspace there, dragging the document to the top with it. The
   * sidebar brings the card into view itself once it has a position.
   */
  preventScroll?: boolean
  /** Text to open with — set when editing an existing comment. */
  initialValue?: string
  onSubmit: (body: string) => void
  onCancel: () => void
}

export function CommentComposer({
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  autoFocus = false,
  preventScroll = false,
  initialValue = '',
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialValue)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    field.current?.focus({ preventScroll })
    // Caret at the end rather than the start: editing usually means adding to
    // what is there, and selecting it all would make the next key wipe it.
    const end = field.current?.value.length ?? 0
    field.current?.setSelectionRange(end, end)
  }, [autoFocus, preventScroll])

  const submit = () => {
    const trimmed = body.trim()
    if (!trimmed) return
    setBody('')
    onSubmit(trimmed)
  }

  return (
    <div className="composer">
      <textarea
        ref={field}
        value={body}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={event => setBody(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn--primary"
          disabled={!body.trim()}
          title={`${submitLabel} (⌘⏎)`}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
