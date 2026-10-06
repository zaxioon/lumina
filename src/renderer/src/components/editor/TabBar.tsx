import { useAppStore } from '../../store/appStore'
import { useEffect, useRef } from 'react'

interface TabBarProps {
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function TabBar({ onSelect, onClose, onNew }: TabBarProps): JSX.Element {
  const tabs = useAppStore(s => s.tabs)
  const activeId = useAppStore(s => s.activeTabId)
  const activeTabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeId])
  return <div role="tablist" aria-label="Open documents" className="lm-tab-bar">
    {tabs.map((tab, index) => {
      const name = tab.path?.split(/[/\\]/).pop() ?? `Untitled ${index + 1}`
      return <div key={tab.id} ref={tab.id === activeId ? activeTabRef : undefined} className={`lm-tab${tab.id === activeId ? ' lm-tab-active' : ''}`}>
        <button type="button" role="tab" aria-selected={tab.id === activeId} aria-controls="document-panel"
          id={`tab-${tab.id}`} title={tab.path ?? name} onClick={() => onSelect(tab.id)}
          onKeyDown={event => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault()
              const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
              onSelect(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            }
          }}>
          <span className="lm-tab-name">{name}</span>
          {tab.isDirty && <span className="lm-tab-dirty" aria-label="Unsaved changes">•</span>}
        </button>
        <button type="button" className="lm-tab-close" aria-label={`Close ${name}`} title="Close tab" onClick={() => onClose(tab.id)}>×</button>
      </div>
    })}
    <button type="button" className="lm-tab-new" title="New document" aria-label="New document" onClick={onNew}>+</button>
  </div>
}
