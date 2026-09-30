import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** The creator space is public content and stays indexable (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/creator')
}

export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return children
}
