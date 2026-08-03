import { useEffect, useRef, useState } from 'react'
import { type ShareOutcome, shareTask, taskUrl } from '../lib/share'
import { Icon } from './Icon'

/**
 * "Have a look at this one."
 *
 * A household coordinates in a group chat, so the useful unit to hand over is a
 * URL, not a screenshot. One tap: the OS share sheet where there is one, the
 * clipboard otherwise.
 *
 * The third path is the one that has to exist rather than the one worth designing
 * for. `navigator.share` and `navigator.clipboard` both need a secure context, and
 * this app is opened over plain http on a LAN as a matter of course — which is the
 * phone, which is where sharing happens. So when both are missing the URL is shown
 * for the user to copy by hand, selected and ready, instead of the button quietly
 * doing nothing.
 */
export function ShareTaskButton({
  workspaceId,
  taskId,
  taskName,
}: {
  workspaceId: string
  taskId: string
  taskName: string
}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)

  // The confirmation is transient; the manual URL stays until dismissed, because
  // it is the thing the user is in the middle of copying.
  useEffect(() => {
    if (outcome !== 'copied') return
    const timer = setTimeout(() => setOutcome(null), 2000)
    return () => clearTimeout(timer)
  }, [outcome])

  useEffect(() => {
    if (outcome === 'manual') fallbackRef.current?.select()
  }, [outcome])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          void shareTask({ workspaceId, taskId, taskName }).then(setOutcome)
        }}
        // Neutral on purpose: the same button opens the OS sheet on a phone and
        // copies on a desktop, so a label promising either one is wrong somewhere.
        aria-label={`Share "${taskName}"`}
        title="Share this task"
        className="icon-btn icon-btn-ghost"
      >
        {/*
          The confirmation is the icon, in the colour the app already uses for "this
          is done" — not a filled `icon-btn-primary`. That variant sets `color: #fff`
          for its glyph and never gets it: the unlayered `button { color: inherit }`
          in `index.css` outranks every `@utility`, so the tick would come out dark
          on accent. Colouring the icon puts the token where nothing is competing.
        */}
        <Icon
          name={outcome === 'copied' ? 'check' : 'link'}
          size={17}
          strokeWidth={outcome === 'copied' ? 2.5 : 1.75}
          className={outcome === 'copied' ? 'text-done' : ''}
        />
      </button>

      {/*
        Announced, not only drawn: the icon swapping to a tick is invisible to a
        screen reader, and "did that work?" is the entire question a copy button
        has to answer.
      */}
      <p aria-live="polite" className="sr-only">
        {outcome === 'copied' ? 'Link copied' : ''}
      </p>

      {outcome === 'manual' && (
        <div className="card absolute right-0 z-30 mt-1 w-72 max-w-[80vw] p-2 text-left">
          <p className="flex items-center gap-1.5 px-0.5 text-xs text-text-dim">
            <Icon name="link" size={13} />
            Copy this link
            <button
              type="button"
              onClick={() => setOutcome(null)}
              aria-label="Close"
              className="ml-auto text-text-dim hover:text-text"
            >
              <Icon name="x" size={14} strokeWidth={2.25} />
            </button>
          </p>
          <input
            ref={fallbackRef}
            readOnly
            value={taskUrl(workspaceId, taskId)}
            aria-label={`Link to "${taskName}"`}
            onFocus={(event) => event.target.select()}
            className="field mt-1 text-xs"
          />
          <p className="mt-1 px-0.5 text-xs text-text-dim">
            This browser needs https to copy for us. Long-press to copy it by hand.
          </p>
        </div>
      )}
    </div>
  )
}
