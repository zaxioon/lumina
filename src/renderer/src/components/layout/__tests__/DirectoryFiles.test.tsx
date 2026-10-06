import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryFiles } from '../DirectoryFiles'
import type { DirectoryListing } from '../../../types/file'
const listDirectory = vi.fn()
beforeEach(() => { window.api.listDirectory = listDirectory; listDirectory.mockReset() })
afterEach(cleanup)
describe('current folder', () => {
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
