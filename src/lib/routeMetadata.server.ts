import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildRouteMetadata } from './routeMetadata'

/**
 * Server-side helper for the per-route `metadata` / `generateMetadata` exports
 * (#657). Route segments that render client components can't export metadata
 * themselves, so they get a `layout.tsx` that delegates here; server-component
 * pages call `routeMetadata(path)` directly.
 *
 * Importing `next-intl/server` keeps this module server-only.
 */
export async function routeMetadata(path: string): Promise<Metadata> {
  const t = await getTranslations('Metadata')
  // The route table composes keys as `${routeKey}.title`; next-intl types the
  // translator against the literal union, so widen once here.
  const metadata = buildRouteMetadata(path, (key) => t(key as never))
  if (!metadata) {
    throw new Error(`No metadata registered for route "${path}" in src/lib/routeMetadata.ts`)
  }
  return metadata
}
