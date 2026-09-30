import type { Metadata } from 'next'

/**
 * Per-route document metadata (#657).
 *
 * The root layout owns the `title.template` and the site default; each route
 * segment contributes only its own page title and description, so the template
 * turns them into "Portfolio | Heliobond" without repeating the brand by hand.
 *
 * The copy itself lives in the message catalogs under `Metadata` so it is
 * localized like the rest of the UI — `buildRouteMetadata()` takes a translator
 * for the `Metadata` namespace, which the segment layouts get from
 * `getTranslations()`. Keeping the route table here (rather than in the
 * layouts) lets `robots.ts`, `sitemap.ts` and the metadata test agree on which
 * routes are wallet-private.
 */

/** Applied by the root layout to every child segment's title. */
export const TITLE_TEMPLATE = '%s | Heliobond'

/** Home page title, and the fallback for any segment that sets no title. */
export const SITE_TITLE = 'Sunlight made financial'

/** Wallet-private and internal routes must never appear in a result page. */
const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: false }

export interface RouteDefinition {
  /** App Router segment path, no trailing slash. */
  readonly path: string
  /** True for routes that show wallet-private or internal data. */
  readonly private: boolean
  /** `Metadata` namespace key holding this route's title and description. */
  readonly key: string
}

/**
 * Every route segment that renders a document. `/project/[id]` is absent: it
 * resolves its title per project through `generateMetadata` in its own page.
 */
export const ROUTES: readonly RouteDefinition[] = [
  { path: '/', private: false, key: 'home' },
  { path: '/connect', private: true, key: 'connect' },
  { path: '/explore', private: false, key: 'explore' },
  { path: '/creator', private: false, key: 'creator' },
  { path: '/deposit', private: true, key: 'deposit' },
  { path: '/learn', private: false, key: 'learn' },
  { path: '/portfolio', private: true, key: 'portfolio' },
  { path: '/portfolio/tax-reports', private: true, key: 'taxReports' },
  { path: '/risk', private: false, key: 'risk' },
  { path: '/verify', private: false, key: 'verify' },
  { path: '/watchlist', private: true, key: 'watchlist' },
  { path: '/withdraw', private: true, key: 'withdraw' },
  { path: '/admin', private: true, key: 'admin' },
]

/** Wallet-private and internal routes: `noindex` in metadata, disallowed in robots.txt. */
export const PRIVATE_ROUTES: readonly string[] = ROUTES.filter((r) => r.private).map((r) => r.path)

/** Indexable routes, safe to list in the sitemap. */
export const PUBLIC_ROUTES: readonly string[] = ROUTES.filter((r) => !r.private).map((r) => r.path)

/** Translates a `Metadata` namespace key; `getTranslations('Metadata')` fits. */
export type MetadataTranslator = (key: string) => string

/**
 * Document metadata for a route, or `undefined` when the route is not in the
 * table (a dynamic segment with its own `generateMetadata`, or a dev route).
 */
export function buildRouteMetadata(path: string, t: MetadataTranslator): Metadata | undefined {
  const route = ROUTES.find((r) => r.path === path)
  if (!route) return undefined

  const title = t(`${route.key}.title`)
  const description = t(`${route.key}.description`)
  const metadata: Metadata = {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  }
  if (route.private) metadata.robots = NOINDEX
  return metadata
}

/** True when the route is wallet-private or internal. */
export function isPrivateRoute(path: string): boolean {
  return PRIVATE_ROUTES.includes(path)
}
