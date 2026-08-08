import { BlogPublisherExtension } from './blog'
import type { MertzExtension } from './types'

export const extensions = [
  BlogPublisherExtension as unknown as MertzExtension<unknown>,
] as const

const ids = new Set<string>()
for (const extension of extensions) {
  if (!/^[a-z][a-z0-9-]*$/.test(extension.id)) {
    throw new Error(`Invalid extension id: ${extension.id}`)
  }
  if (ids.has(extension.id)) throw new Error(`Duplicate extension id: ${extension.id}`)
  ids.add(extension.id)
}
