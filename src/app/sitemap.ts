import type { MetadataRoute } from 'next'
import { getProjects } from '../lib/api'
import { CANONICAL_ORIGIN, PUBLIC_ROUTES } from '../lib/routeMetadata'

const BASE_URL = CANONICAL_ORIGIN

type SitemapEntry = MetadataRoute.Sitemap[number]

/** Crawl weight and expected churn for each indexable static route (#657). */
const STATIC_ROUTE_PRIORITY: Record<
  string,
  { changeFrequency: NonNullable<SitemapEntry['changeFrequency']>; priority: number }
> = {
  '/': { changeFrequency: 'daily', priority: 1.0 },
  '/explore': { changeFrequency: 'daily', priority: 0.8 },
  '/creator': { changeFrequency: 'weekly', priority: 0.7 },
  '/learn': { changeFrequency: 'weekly', priority: 0.6 },
  '/verify': { changeFrequency: 'monthly', priority: 0.5 },
  '/risk': { changeFrequency: 'monthly', priority: 0.5 },
}

/**
 * Only indexable, public URLs. Wallet-private routes (portfolio, deposit,
 * withdraw, connect, watchlist, tax reports, admin) and dev-only routes are
 * excluded — they carry `robots: noindex` and are disallowed in robots.txt.
 *
 * Project URLs come from the same data layer `/project/[id]` uses, so a project
 * is either listed here and reachable, or neither.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route === '/' ? '' : route}`,
    lastModified: new Date(),
    ...(STATIC_ROUTE_PRIORITY[route] ?? { changeFrequency: 'weekly', priority: 0.5 }),
  }))

  // Never let a backend hiccup take the sitemap down — an empty project list
  // still leaves the static routes valid.
  const projects = await getProjects().catch(() => [])

  const projectRoutes: MetadataRoute.Sitemap = projects.map((project) => ({
    url: `${BASE_URL}/project/${project.id}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...projectRoutes]
}
