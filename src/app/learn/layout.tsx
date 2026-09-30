import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** The "how it works" page is public content and stays indexable (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/learn')
}

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return children
}
