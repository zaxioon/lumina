export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'document' | 'attachment'; path: string; anchor: string }

export type ResolveLinkResult = { target: LinkTarget; error?: never } | { error: string; target?: never }
