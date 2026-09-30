import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** The verification page is public trust content and stays indexable (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/verify')
}

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children
}
