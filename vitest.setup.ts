import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import en from './messages/en.json'

type Messages = Record<string, unknown>

/**
 * `getTranslations()` needs a live request (cookies + the request config), which
 * jsdom doesn't have. Route metadata resolves its copy through it, so tests get
 * the English catalog directly instead — same shape, no network.
 */
vi.mock('next-intl/server', async () => {
  /** Resolves a dotted key against the English catalog, namespace included. */
  const lookup = (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Messages)?.[part], en as unknown as Messages)
    if (typeof value !== 'string') throw new Error(`Missing message: ${key}`)
    return value
  }
  return {
    // Mirrors next-intl: the returned translator is scoped to the namespace.
    getTranslations: async (namespace?: string) =>
      namespace ? (key: string) => lookup(`${namespace}.${key}`) : lookup,
    getLocale: async () => 'en',
    getMessages: async () => en,
  }
})

if (typeof window !== 'undefined') {
  if (!window.localStorage || typeof window.localStorage.clear !== 'function') {
    const store = new Map<string, string>()
    const storageMock: Storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size
      },
    }
    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true,
    })
  }
}
