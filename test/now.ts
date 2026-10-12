import { answer as door, type Reply } from '../doors.ts'

/**
 * `answer`, for a call that is answered at once — every door but the one tool
 * that waits, show_slide, which is awaited where it is tested.
 */
export const answer = (...args: Parameters<typeof door>) => door(...args) as Reply | null
