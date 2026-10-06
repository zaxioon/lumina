import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dirname, join, parse } from 'path'
const mocks = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn(), get: vi.fn(), set: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }))
vi.mock('fs/promises', () => { const api = { readFile: mocks.readFile, readdir: mocks.readdir, stat: mocks.stat }; return { ...api, default: api } })
vi.mock('electron', () => { const api = { app: { getPath: () => '/documents' }, BrowserWindow: class {}, dialog: { showOpenDialog: mocks.showOpenDialog, showMessageBox: mocks.showMessageBox } }; return { ...api, default: api } })
vi.mock('../store', () => ({ default: { get: mocks.get, set: mocks.set } }))
import { listDocumentDirectory, openDocumentDialog } from '../fileBrowser'
import type { BrowserWindow } from 'electron'
const win = {} as BrowserWindow

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockReturnValue('')
  mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
})

describe('directory listing', () => {
  it('lists direct supported files including uppercase extensions in natural order', async () => {
    mocks.readdir.mockResolvedValue([
      ['part10.MD', true], ['part2.markdown', true], ['notes.txt', true], ['image.png', true], ['folder.md', false],
    ].map(([name, file]) => ({ name, isFile: () => file })))
    const result = await listDocumentDirectory(join('/docs', 'part2.markdown'))
    expect(result.files.map((file) => file.name)).toEqual(['notes.txt', 'part2.markdown', 'part10.MD'])
    expect(result.files[0].path).toBe(join('/docs', 'notes.txt'))
  })
  it('keeps filesystem roots intact', async () => {
    mocks.readdir.mockResolvedValue([])
    const root = parse(process.cwd()).root
    expect((await listDocumentDirectory(join(root, 'document.md'))).path).toBe(root)
    expect(mocks.readdir).toHaveBeenCalledWith(root, { withFileTypes: true })
  })
  it('returns an actionable error for inaccessible directories', async () => {
    mocks.readdir.mockRejectedValue(new Error('EACCES'))
    expect(await listDocumentDirectory('/gone/file.md')).toMatchObject({ files: [], error: expect.any(String) })
  })
})

describe('remembered Open File directory', () => {
  it('uses a remembered existing folder and caches a successfully read selection', async () => {
    mocks.get.mockReturnValue('/remembered')
    mocks.stat.mockResolvedValue({ isDirectory: () => true })
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/chosen/file.md'] })
    mocks.readFile.mockResolvedValue('\uFEFFhello')
    expect(await openDocumentDialog(win)).toEqual({ path: '/chosen/file.md', content: 'hello' })
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(win, expect.objectContaining({ defaultPath: '/remembered' }))
    expect(mocks.set).toHaveBeenCalledWith('lastOpenDirectory', dirname('/chosen/file.md'))
  })
  it('falls back when the remembered folder was removed and cancellation preserves cache', async () => {
    mocks.get.mockReturnValue('/removed')
    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    expect(await openDocumentDialog(win)).toBeNull()
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(win, expect.objectContaining({ defaultPath: join('/documents', 'Lumina') }))
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('preserves the previous directory when selected file reading fails', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/gone/file.md'] })
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    expect(await openDocumentDialog(win)).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.showMessageBox).toHaveBeenCalled()
  })
})
