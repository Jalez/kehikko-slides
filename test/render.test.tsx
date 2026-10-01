import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import { Screen } from '../src/app.tsx'
import type { Api } from '../src/wire/api.ts'
import type { Host } from '../src/wire/use-roadmap.ts'

afterEach(cleanup)

function host(over: Partial<Host> = {}): Host {
  return {
    where: 'hosted',
    project: 'Thesis',
    projectPath: '/work/thesis',
    epic: 'write-chapter-two',
    theme: 'dark',
    request: () => Promise.resolve(null),
    ...over,
  }
}

const fakeApi = (value: unknown): Api => ({ read: () => Promise.resolve(value), write: () => Promise.resolve() })

describe('the screen', () => {
  test('shows the project, epic and theme the host sent', () => {
    render(<Screen host={host()} api={fakeApi(null)} />)
    expect(screen.getByTestId('project').textContent).toBe('Thesis')
    expect(screen.getByTestId('epic').textContent).toBe('write-chapter-two')
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(screen.getByTestId('where').textContent).toBe('hosted')
  })

  test('shows the value stored in the project', async () => {
    render(<Screen host={host()} api={fakeApi('kept')} />)
    await waitFor(() => expect((screen.getByLabelText(/a value kept/) as HTMLInputElement).value).toBe('kept'))
  })

  test('with no project it says so rather than offering to save nowhere', () => {
    render(<Screen host={host({ projectPath: null, project: null, epic: null, where: 'unhosted' })} api={fakeApi(null)} />)
    expect(screen.getByText(/Open a project/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  test('the header switcher shows the open item', () => {
    render(<Screen host={host()} api={fakeApi(null)} />)
    expect(screen.getByRole('button', { name: /First/ })).toBeDefined()
  })
})
