import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** Connect is wallet-private: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/connect')
}

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return children
}
