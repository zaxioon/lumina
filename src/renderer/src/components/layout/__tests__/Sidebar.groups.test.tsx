import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../Sidebar'
import { useAppStore } from '../../../store/appStore'

beforeEach(() => {
  useAppStore.setState({
    sidebarOpen: true,
    file: { path: null, content: '', isDirty: false, fileType: 'md' },
    draft: null,
    recentFiles: Array.from({ length: 8 }, (_, i) => ({ path: `/docs/note${i + 1}.md`, name: `note${i + 1}.md`, lastOpened: new Date().toISOString(), snippet: 'searchable text' })),
  })
})
afterEach(cleanup)

describe('sidebar groups', () => {
  it('limits Recent to six entries and supports show more and show less', () => {
    render(<Sidebar onOpenFile={vi.fn()} onOpenDraft={vi.fn()} />)
    const recent = within(screen.getByRole('region', { name: 'Recent files' }))
    expect(recent.getByText('note6.md')).not.toBeNull()
    expect(recent.queryByText('note7.md')).toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'Show more' }))
    expect(recent.getByText('note8.md')).not.toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'Show less' }))
    expect(recent.queryByText('note7.md')).toBeNull()
    expect(screen.queryByTitle('New file')).toBeNull()
  })

  it('searches every recent file while collapsed and restores the prior state on clear', () => {
    render(<Sidebar onOpenFile={vi.fn()} onOpenDraft={vi.fn()} />)
    const recent = within(screen.getByRole('region', { name: 'Recent files' }))
    fireEvent.click(recent.getByRole('button', { name: 'Recent' }))
    expect(recent.queryByText('note1.md')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search files'), { target: { value: 'searchable' } })
    expect(recent.getByText('note8.md')).not.toBeNull()
    expect(recent.queryByRole('button', { name: 'Show more' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search files'), { target: { value: '' } })
    expect(recent.queryByText('note1.md')).toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'Recent' }))
    expect(recent.getByText('note6.md')).not.toBeNull()
    expect(recent.queryByText('note7.md')).toBeNull()
  })
})
