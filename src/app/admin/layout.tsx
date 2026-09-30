import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** Admin is internal: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/admin')
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
