/**
 * The export formats, shared by the desktop menu and the phone actions sheet.
 *
 * Its own module rather than a constant exported from ExportMenu: a file that
 * exports both a component and a value loses fast refresh.
 */

/** Just the four export handlers — what a format needs to run, nothing else. */
export interface ExportActions {
  onExport: () => void
  onExportDocx: () => void
  onExportDocxAnnotated: () => void
  onExportAnnotated: () => void
}

export interface Format {
  id: string
  label: string
  hint: string
  run: (actions: ExportActions) => void
}

/**
 * In order of how much of the app they carry.
 *
 * Markdown first because it is the one with the guarantee; the two that carry
 * comments are last, and say so, because "with comments" is the decision the
 * user is actually making when they pick one of them.
 */
export const FORMATS: Format[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    hint: 'Clean GFM, bundled with an images folder when needed. Never any comments.',
    run: actions => actions.onExport(),
  },
  {
    id: 'docx',
    label: 'Word',
    hint: 'A .docx for readers who work in Word. No comments.',
    run: actions => actions.onExportDocx(),
  },
  {
    id: 'docx-comments',
    label: 'Word, with comments',
    hint: 'A .docx whose threads open in Word’s review pane.',
    run: actions => actions.onExportDocxAnnotated(),
  },
  {
    id: 'html-comments',
    label: 'HTML, with comments',
    hint: 'One self-contained page, comments in an annex.',
    run: actions => actions.onExportAnnotated(),
  },
]
