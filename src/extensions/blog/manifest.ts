import type { MertzExtension } from '../types'
import { BlogSettings } from './components/BlogSettings'
import { PublishButton } from './components/PublishButton'
import { PublishPanel } from './components/PublishPanel'
import {
  BLOG_EXTENSION_ID,
  DEFAULT_BLOG_SETTINGS,
  type BlogExtensionSettings,
} from './state'

export const BlogPublisherExtension: MertzExtension<BlogExtensionSettings> = {
  id: BLOG_EXTENSION_ID,
  name: 'Blog Publisher',
  version: 1,
  defaultEnabled: false,
  defaultSettings: DEFAULT_BLOG_SETTINGS,
  documentActions: [
    {
      id: 'publish',
      order: 50,
      Component: PublishButton,
    },
  ],
  SettingsPanel: BlogSettings,
  DocumentPanel: PublishPanel,
}
