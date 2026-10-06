/** Display URLs belong to the host; canonical media URLs stay in the document model. */
export function toDisplayMediaUrl(url: string): string {
  return window.api?.displayMediaUrl?.(url) ?? url
}
