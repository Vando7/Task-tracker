import { useEffect, useRef, useState } from 'react'

/**
 * Click to edit, blur or Enter to save, Escape to cancel.
 *
 * A real `input`/`textarea` rather than `contenteditable`. The legacy app used
 * `contenteditable` as a form field, which gives you no label, no validation, no
 * maxlength, and an editing surface screen readers announce as a document region
 * (Part 2, gap 39). This keeps the same click-to-edit feel with an actual control
 * underneath.
 */
export function InlineText({
  value,
  onSave,
  label,
  className = '',
  placeholder,
  maxLength,
  multiline = false,
}: {
  value: string
  onSave: (next: string) => void
  label: string
  className?: string
  placeholder?: string
  maxLength?: number
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  // If the value changes underneath us (someone else edited it, arriving over
  // SSE), take the new value — unless we are mid-edit, in which case the user's
  // typing wins.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== value.trim()) onSave(trimmed)
  }

  const cancel = (): void => {
    setEditing(false)
    setDraft(value)
  }

  if (!editing) {
    const isEmpty = value.trim().length === 0
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`block w-full cursor-text text-left ${className} ${isEmpty ? 'text-text-dim/60 italic' : ''}`}
        aria-label={`${label}: click to edit`}
      >
        {isEmpty ? (placeholder ?? label) : value}
      </button>
    )
  }

  const shared = {
    ref: inputRef as never,
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    'aria-label': label,
    maxLength,
    placeholder,
    className: `w-full rounded-lg border border-edge bg-ink px-2 py-1 ${className}`,
  }

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={3}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
          // Enter inserts a newline in a description; Cmd/Ctrl+Enter saves.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit()
        }}
      />
    )
  }

  return (
    <input
      {...shared}
      type="text"
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') cancel()
      }}
    />
  )
}
