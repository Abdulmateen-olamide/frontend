import type { Metadata } from 'next'
import { routeMetadata } from '../../lib/routeMetadata.server'

/** Withdraw is wallet-private: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/withdraw')
}

export default function WithdrawLayout({ children }: { children: React.ReactNode }) {
  return children
}
