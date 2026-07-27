import { useTheme } from '../lib/useTheme'
import { Icon } from './Icon'

/**
 * One button: shows what you'd get if you pressed it.
 *
 * A long-press-free, menu-free control on purpose — this is a chore app used
 * one-handed. "Follow the system" is still reachable from Settings, where a
 * three-way choice can be explained.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolved, toggle } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      className={`icon-btn ${className}`}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  )
}

/** The explicit three-way choice, for Settings. */
export function ThemeChoice() {
  const { preference, setPreference } = useTheme()

  const options = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'system', label: 'System', icon: 'sliders' },
  ] as const

  return (
    <div className="inline-flex gap-1 rounded-xl border border-edge bg-ink p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setPreference(option.value)}
          aria-pressed={preference === option.value}
          className={[
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors',
            preference === option.value
              ? 'bg-ink-raised text-text shadow-sm'
              : 'text-text-dim hover:text-text',
          ].join(' ')}
        >
          <Icon name={option.icon} size={16} />
          {option.label}
        </button>
      ))}
    </div>
  )
}
