import { useEffect, useMemo } from 'react'

import { useRoadmap as useProtocolRoadmap, type Roadmap, type Where } from 'roadmap-module-protocol/client/react'

import { ID } from '../../manifest.ts'

/**
 * What the screen needs from the host, and nothing about how it arrived.
 *
 * A thin wrapper over the protocol's `useRoadmap`: it applies the host's theme
 * to <html> and flattens the context into the fields this module reads, so a
 * screen can be rendered in a test with a plain object (see `Host`).
 */
export interface Host {
  /** 'listening' until a host greets or the grace runs out; then 'hosted' or 'unhosted'. */
  where: Where
  project: string | null
  /** The absolute directory of the open project. Where this module keeps its data. */
  projectPath: string | null
  epic: string | null
  theme: 'light' | 'dark'
  /** Ask the host for something (a method from the protocol). Rejects when unhosted. */
  request: Roadmap['request']
}

export function useRoadmap(): Host {
  const roadmap = useProtocolRoadmap(ID)
  const context = roadmap.context
  const theme = context?.theme ?? 'light'

  useEffect(() => {
    if (!context) return
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
  }, [context, theme])

  return useMemo(
    () => ({
      where: roadmap.where,
      project: context?.project ?? null,
      projectPath: context?.projectPath ?? null,
      epic: context?.epic ?? null,
      theme,
      request: roadmap.request,
    }),
    [roadmap.where, roadmap.request, context, theme],
  )
}
