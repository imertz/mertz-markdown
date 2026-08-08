import type { DocumentActionProps } from '../../types'

export function PublishButton({
  surface,
  openPanel,
  disabled,
}: DocumentActionProps) {
  return (
    <button
      type="button"
      className={
        surface === 'header'
          ? 'publish-action publish-action--header'
          : 'actions-menu__option'
      }
      role={surface === 'menu' ? 'menuitem' : undefined}
      disabled={disabled}
      onClick={openPanel}
    >
      Publish
    </button>
  )
}
