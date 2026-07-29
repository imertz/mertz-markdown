# Every Empire Starts With a Blank Page

> True glory consists in doing what deserves to be written; in writing what
> deserves to be read.
>
> — Pliny the Elder

Every civilisation keeps its records twice: once in stone, and once in a format
you can still open a thousand years later. This one chose **plain text**.

## The Founding Decree

The realm keeps a single promise: *what you export is what you wrote*. No stray
`<div>`, no smart quotes nobody asked for, no invisible characters smuggled in
from a paste. A margin note lives beside the sentence, never inside it — so the
`.md` on disk stays clean enough to hand to a stranger.

## Advisors of the Realm

| Advisor  |             Counsel             |  Verdict |
| :------- | :-----------------------------: | -------: |
| Science  | Syntax highlighting             |  Adopted |
| Culture  | Comment threads in the margin   |  Adopted |
| Treasury | A monthly subscription          | Repelled |
| Military | Your notes on a stranger's disk | Repelled |

## Decrees in Progress

- [x] Write in a format that outlives its editor
- [x] Annotate without polluting the file
- [ ] Finish the chronicle before the sun sets

## The Royal Archive

The document is canonical; the markdown is derived from it on every save, never
the reverse:

```ts
export function toMarkdown(editor: Editor): string {
  return serializeDoc(editor, editor.getJSON())
}
```

---

Offline-first, and fluent in [GitHub Flavored Markdown](https://github.github.com/gfm/).
Nothing leaves the device. ~~Trust me~~ Read the export.
