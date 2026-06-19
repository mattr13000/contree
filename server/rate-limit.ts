// Per-socket token-bucket rate limiter. Cheap protection against a single
// connection flooding events (room create/leave loops, bid/play spam) and
// churning the in-memory state / lobby broadcasts. Silently drops over-budget
// packets (no error emit → no feedback channel to amplify against us).
import type { AppSocket } from './io-types.js'

const CAPACITY    = 30   // burst allowance (tokens)
const REFILL_RATE = 15   // tokens added per second

/** Attach a token bucket to one socket's inbound event stream. */
export function rateLimit(socket: AppSocket): void {
  let tokens = CAPACITY
  let last   = Date.now()

  socket.use((_packet, next) => {
    const now = Date.now()
    tokens = Math.min(CAPACITY, tokens + ((now - last) / 1000) * REFILL_RATE)
    last = now
    if (tokens < 1) return            // over budget → drop the event silently
    tokens -= 1
    next()
  })
}
