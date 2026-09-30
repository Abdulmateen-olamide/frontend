import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { devRoutesEnabled } from '../../lib/devRoutes'

// Internal tooling — never index, even when a preview deploy enables these routes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Route group for dev-only pages (#606). In production builds every route in
 * this group renders the app 404 unless NEXT_PUBLIC_ENABLE_DEV_ROUTES=true.
 */
export default function DevRoutesLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound()
  return children
}
