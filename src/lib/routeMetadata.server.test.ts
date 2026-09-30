import { describe, it, expect } from 'vitest'
import en from '../../messages/en.json'
import { PRIVATE_ROUTES, PUBLIC_ROUTES, ROUTES, TITLE_TEMPLATE } from './routeMetadata'
import { routeMetadata } from './routeMetadata.server'

/**
 * The server helper every route segment's metadata goes through (#657). These
 * assertions cover the wiring — localized copy, the noindex split, and the
 * fail-loud path for a route that isn't in the table.
 */
describe('routeMetadata() server helper (#657)', () => {
  it.each(ROUTES.map((r) => [r.path, r.key] as const))(
    'resolves localized copy for %s',
    async (path, key) => {
      const metadata = await routeMetadata(path)
      expect(metadata.title).toBe(en.Metadata[key as keyof typeof en.Metadata].title)
      expect(metadata.description).toBe(en.Metadata[key as keyof typeof en.Metadata].description)
    },
  )

  it('applies the brand suffix through the root template, not by hand', async () => {
    const metadata = await routeMetadata('/portfolio')
    const title = String(metadata.title)
    expect(title.endsWith('| Heliobond')).toBe(false)
    expect(TITLE_TEMPLATE.replace('%s', title)).toBe(`${title} | Heliobond`)
  })

  it('noindexes every wallet-private route and nothing else', async () => {
    for (const path of PRIVATE_ROUTES) {
      expect((await routeMetadata(path)).robots).toEqual({ index: false, follow: false })
    }
    for (const path of PUBLIC_ROUTES) {
      expect((await routeMetadata(path)).robots).toBeUndefined()
    }
  })

  it('sets a matching openGraph title and description on every route', async () => {
    for (const { path } of ROUTES) {
      const { openGraph } = await routeMetadata(path)
      expect(openGraph?.title).toBe((await routeMetadata(path)).title)
      expect(openGraph?.description).toBe((await routeMetadata(path)).description)
    }
  })

  it('throws for a route that is not in the table', async () => {
    await expect(routeMetadata('/project/[id]')).rejects.toThrow(/No metadata registered/)
  })
})
