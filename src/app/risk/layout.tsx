import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** The risk disclosure is public trust content and stays indexable (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/risk')
}

export default function RiskLayout({ children }: { children: React.ReactNode }) {
  return children
}
