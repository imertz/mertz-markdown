interface PwaPromptProps {
  needRefresh: boolean
  offlineReady: boolean
  onUpdate: () => void
  onDismissUpdate: () => void
  onDismissOfflineReady: () => void
}

export function PwaPrompt({
  needRefresh,
  offlineReady,
  onUpdate,
  onDismissUpdate,
  onDismissOfflineReady,
}: PwaPromptProps) {
  if (needRefresh) {
    return (
      <div className="toast" role="status">
        <span>A new version is ready.</span>
        <button type="button" onClick={onUpdate}>
          Reload
        </button>
        <button type="button" onClick={onDismissUpdate}>
          Later
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className="toast" role="status">
        <span>Ready to work offline.</span>
        <button type="button" onClick={onDismissOfflineReady}>
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
