import { registerFileHandlers } from './fileHandlers'
import { registerImageHandlers } from './imageHandlers'
import { registerLinkHandlers } from './linkHandlers'
import { registerTabHandlers } from './tabHandlers'

export function registerAllHandlers(): void {
  registerFileHandlers()
  registerImageHandlers()
  registerLinkHandlers()
  registerTabHandlers()
}
