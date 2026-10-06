import { useEffect, useState } from 'react'
import { ChevronDown, FileText, RefreshCw } from 'lucide-react'
import type { DirectoryListing } from '../../types/file'
import { sameDocumentPath } from '../../utils/linkNavigation'

interface Props {
  documentPath: string | null
  query: string
  onOpenFile: (path: string) => void
}

export function DirectoryFiles({ documentPath, query, onOpenFile }: Props): JSX.Element {
  const [result, setResult] = useState<{ documentPath: string; listing: DirectoryListing } | null>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (!documentPath) return
    let canceled = false
    setLoading(true)
    const load = async (): Promise<void> => {
      try {
        const listing = await window.api.listDirectory(documentPath)
        if (!canceled) setResult({ documentPath, listing })
      } catch {
        if (!canceled) setResult({ documentPath, listing: { path: '', files: [], error: 'Unable to read this folder. Try refreshing.' } })
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    void load()
    return () => { canceled = true }
  }, [documentPath, revision])

  const listing = result?.documentPath === documentPath ? result.listing : null
  const pending = !!documentPath && (loading || !listing)
  const q = query.trim().toLowerCase()
  const files = listing?.files.filter((file) => file.name.toLowerCase().includes(q)) ?? []
  const expanded = !!q || !collapsed
  const visibleFiles = q || showAll ? files : files.slice(0, 6)
  const message = !documentPath ? 'Open a file to browse its folder'
    : pending ? 'Loading folder…'
    : listing?.error ?? (files.length === 0 ? (q ? 'No matching files' : 'No supported files in this folder') : null)

  return (
    <section aria-label="Current folder">
      <div className="flex items-center justify-between px-3 pb-2 pt-3.5" style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--lm-ink-faint)' }}>
        <button className="lm-sidebar-group-toggle" aria-expanded={expanded} disabled={!!q} onClick={() => setCollapsed(value => !value)}>
          <ChevronDown size={12} strokeWidth={1.6} style={{ transform: expanded ? undefined : 'rotate(-90deg)' }} />
          <span>Current folder</span>
        </button>
        <button title="Refresh folder" aria-label="Refresh folder" disabled={!documentPath || pending} onClick={() => setRevision((value) => value + 1)} className="hover:opacity-70 disabled:opacity-30" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}>
          <RefreshCw size={12} strokeWidth={1.6} />
        </button>
      </div>
      {expanded && <>
      {listing?.path && !pending && <div title={listing.path} className="px-3 pb-1 truncate" style={{ fontSize: 11, color: 'var(--lm-ink-faint)' }}>{listing.path.split(/[/\\]/).filter(Boolean).pop() ?? listing.path}</div>}
      <div className="px-2.5 pb-2">
        {message ? <div role={listing?.error ? 'alert' : 'status'} style={{ fontSize: 12, color: 'var(--lm-ink-faint)', padding: '8px 12px' }}>{message}</div>
          : visibleFiles.map((file) => {
            const active = sameDocumentPath(file.path, documentPath)
            return (
            <button key={file.path} title={file.path} onClick={() => onOpenFile(file.path)} aria-current={active ? 'page' : undefined} className="w-full flex items-center gap-2 text-left hover:bg-black/5 dark:hover:bg-white/5" style={{ padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', color: 'var(--lm-ink)', background: active ? 'rgba(91,108,255,0.10)' : undefined, fontSize: 12, fontWeight: active ? 600 : 400 }}>
              <FileText size={12} strokeWidth={1.6} style={{ flexShrink: 0, color: active ? '#5B6CFF' : 'var(--lm-ink-faint)' }} />
              <span className="truncate">{file.name}</span>
            </button>
          )})}
        {!q && !message && files.length > 6 && <button className="lm-sidebar-show-more" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show less' : 'Show more'}</button>}
      </div>
      </>}
    </section>
  )
}
