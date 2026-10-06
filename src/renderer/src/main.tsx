import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'

async function start(): Promise<void> {
  // Electron's legacy preload already provides AppApi; Tauri supplies it in the webview.
  if (!window.api) {
    const { createTauriApi } = await import('./tauri-api')
    window.api = await createTauriApi()
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}

void start().catch(error => {
  console.error('Unable to start Lumina:', error)
  document.getElementById('root')!.textContent = 'Lumina could not connect to its native host. Restart the application to try again.'
})
