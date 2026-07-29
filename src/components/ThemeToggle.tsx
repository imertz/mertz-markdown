import type { Theme } from '../hooks/useTheme'
import { MoonIcon, SunIcon } from './icons'

interface ThemeToggleProps {
  theme: Theme
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      // A toggle button: pressed means dark is on, which is what the icon shows.
      aria-pressed={theme === 'dark'}
      onClick={onToggle}
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
