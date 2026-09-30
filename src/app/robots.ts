import type { MetadataRoute } from 'next'
import { DEV_ROUTES } from '../lib/devRoutes'
import { PRIVATE_ROUTES, PUBLIC_ROUTES } from '../lib/routeMetadata'

/**
 * The wallet-private list is derived from the same table the page metadata uses
 * (`src/lib/routeMetadata.ts`), so a route can't be `noindex` in its `<head>`
 * while still being crawlable here — or the reverse (#657).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_ROUTES],
      disallow: [...PRIVATE_ROUTES, ...DEV_ROUTES],
    },
    sitemap: 'https://heliobond.vercel.app/sitemap.xml',
  }
}
