import type { SseEvent, SseEventType } from '@task-tracker/shared'

/**
 * The SSE hub: a registry of subscribers keyed by workspace.
 *
 * This replaces the legacy polling ping, which fetched `max(modified_date)`
 * every 10 seconds and, if it moved, refetched the entire pending list *and* the
 * entire completed list. That could only ever detect *that* something changed,
 * never *what* — so two edits inside one interval collapsed into one, and a
 * change that didn't raise the maximum timestamp was invisible.
 *
 * Publishing fans out to one workspace only. A household never sees another
 * household's traffic, which is both correct and the whole scaling story.
 */

export type SsePayload<T extends SseEventType> = Extract<SseEvent, { type: T }>['data']

type Subscriber = {
  readonly userId: string
  readonly send: (event: SseEvent) => void
}

class EventHub {
  #byWorkspace = new Map<string, Set<Subscriber>>()
  #sequence = 0

  /** Returns the unsubscribe function; callers must invoke it on connection close. */
  subscribe(workspaceId: string, subscriber: Subscriber): () => void {
    let set = this.#byWorkspace.get(workspaceId)
    if (!set) {
      set = new Set()
      this.#byWorkspace.set(workspaceId, set)
    }
    set.add(subscriber)

    return () => {
      const current = this.#byWorkspace.get(workspaceId)
      if (!current) return
      current.delete(subscriber)
      if (current.size === 0) this.#byWorkspace.delete(workspaceId)
    }
  }

  /**
   * Every mutation that changes something another member can see must call
   * this. It is not optional — it is the thing that makes the app feel alive,
   * and it is the easiest part to forget.
   */
  publish<T extends SseEventType>(params: {
    workspaceId: string
    type: T
    data: SsePayload<T>
    /** Who caused it, so a client can skip echoing back its own change. */
    actorId: string | null
  }): void {
    const subscribers = this.#byWorkspace.get(params.workspaceId)
    if (!subscribers || subscribers.size === 0) return

    this.#sequence += 1
    const event = {
      id: String(this.#sequence),
      type: params.type,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      at: new Date().toISOString(),
      data: params.data,
    } as SseEvent

    for (const subscriber of subscribers) {
      try {
        subscriber.send(event)
      } catch {
        // A broken pipe is normal — the client navigated away. The route's
        // close handler removes it; losing this one event is harmless because
        // the client refetches on reconnect.
      }
    }
  }

  /** Deliver to specific users within a workspace, for notifications. */
  publishToUsers<T extends SseEventType>(params: {
    workspaceId: string
    userIds: readonly string[]
    type: T
    data: SsePayload<T>
    actorId: string | null
  }): void {
    const subscribers = this.#byWorkspace.get(params.workspaceId)
    if (!subscribers || subscribers.size === 0) return

    const wanted = new Set(params.userIds)
    this.#sequence += 1
    const event = {
      id: String(this.#sequence),
      type: params.type,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      at: new Date().toISOString(),
      data: params.data,
    } as SseEvent

    for (const subscriber of subscribers) {
      if (!wanted.has(subscriber.userId)) continue
      try {
        subscriber.send(event)
      } catch {
        // See above.
      }
    }
  }

  subscriberCount(workspaceId?: string): number {
    if (workspaceId) return this.#byWorkspace.get(workspaceId)?.size ?? 0
    let total = 0
    for (const set of this.#byWorkspace.values()) total += set.size
    return total
  }
}

export const hub = new EventHub()
