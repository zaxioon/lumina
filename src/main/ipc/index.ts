import { registerFileHandlers } from './fileHandlers'
import { registerImageHandlers } from './imageHandlers'
import { registerLinkHandlers } from './linkHandlers'

export function registerAllHandlers(): void {
  registerFileHandlers()
  registerImageHandlers()
  registerLinkHandlers()
}
