import type { AppApi } from './appApi'

declare global {
  interface Window {
    api: AppApi
    __lumina_isDirty__?: boolean
  }
}
