import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryFiles } from '../DirectoryFiles'
import type { DirectoryListing } from '../../../types/file'
const listDirectory = vi.fn()
beforeEach(() => { window.api.listDirectory = listDirectory; listDirectory.mockReset() })
afterEach(cleanup)
describe('current folder', () => {
  it('previews six files and restores expansion state after searching', async () => {
    listDirectory.mockResolvedValue({ path: '/docs', files: Array.from({ length: 8 }, (_, i) => ({ name: `note${i + 1}.md`, path: `/docs/note${i + 1}.md` })) })
    const props = { documentPath: '/docs/note1.md', onOpenFile: vi.fn() }
    const { rerender } = render(<DirectoryFiles {...props} query="" />)
    await screen.findByText('note6.md')
    expect(screen.queryByText('note7.md')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('note8.md')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    fireEvent.click(screen.getByRole('button', { name: 'Current folder' }))
    expect(screen.queryByText('note1.md')).toBeNull()
    rerender(<DirectoryFiles {...props} query="note" />)
    expect(screen.getByText('note8.md')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    rerender(<DirectoryFiles {...props} query="" />)
    expect(screen.queryByText('note1.md')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Current folder' }))
    expect(screen.getByText('note6.md')).not.toBeNull()
    expect(screen.queryByText('note7.md')).toBeNull()
  })
  it('highlights Windows paths regardless of casing and slash style', async () => {
    listDirectory.mockResolvedValue({ path: 'C:\\Docs', files: [{ name: 'Note.md', path: 'C:\\Docs\\Note.md' }] })
    render(<DirectoryFiles documentPath="c:/docs/note.md" query="" onOpenFile={vi.fn()} />)
    expect((await screen.findByRole('button', { name: 'Note.md' })).getAttribute('aria-current')).toBe('page')
  })
  it('filters filenames with the shared search query and opens selected files', async () => {
    listDirectory.mockResolvedValue({ path: '/docs', files: [{ name: 'readme.md', path: '/docs/readme.md' }, { name: 'notes.txt', path: '/docs/notes.txt' }] })
    const open = vi.fn()
    render(<DirectoryFiles documentPath="/docs/readme.md" query="NOTES" onOpenFile={open} />)
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(screen.queryByText('readme.md')).toBeNull()
    expect(open).toHaveBeenCalledWith('/docs/notes.txt')
  })
  it('ignores stale responses after changing documents', async () => {
    let resolveOld!: (value: DirectoryListing) => void
    listDirectory.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    listDirectory.mockResolvedValueOnce({ path: '/new', files: [{ name: 'new.md', path: '/new/new.md' }] })
    const { rerender } = render(<DirectoryFiles documentPath="/old/old.md" query="" onOpenFile={vi.fn()} />)
    rerender(<DirectoryFiles documentPath="/new/new.md" query="" onOpenFile={vi.fn()} />)
    await screen.findByText('new.md')
    await act(async () => resolveOld({ path: '/old', files: [{ name: 'old.md', path: '/old/old.md' }] }))
    expect(screen.queryByText('old.md')).toBeNull()
    expect(screen.getByText('new.md')).not.toBeNull()
  })
  it('offers refresh after a listing failure', async () => {
    listDirectory.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ path: '/docs', files: [] })
    render(<DirectoryFiles documentPath="/docs/file.md" query="" onOpenFile={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Unable to read')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh folder' }))
    expect(await screen.findByText('No supported files in this folder')).not.toBeNull()
  })
})
