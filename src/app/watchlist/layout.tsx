import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** Wallet-private: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/watchlist')
}

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return children
}
