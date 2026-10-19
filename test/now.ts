import { answer as door, type Reply } from '../doors.ts'

/** `answer`, awaited: the project doors ask the host (`test/host.ts`) before they answer. */
export const answer = async (...args: Parameters<typeof door>): Promise<Reply | null> => door(...args)
