import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** Deposit is wallet-private: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/deposit')
}

export default function DepositLayout({ children }: { children: React.ReactNode }) {
  return children
}
