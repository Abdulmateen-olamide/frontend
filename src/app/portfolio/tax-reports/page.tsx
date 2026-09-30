import type { Metadata } from 'next'
import { TaxReports } from '@/screens/TaxReports'
import { RequireWallet } from '@/wallet/RequireWallet'
import { routeMetadata } from '../../../lib/routeMetadata.server'

/** Wallet-private: noindex, and disallowed in robots.txt (#657). */
export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/portfolio/tax-reports')
}

export default function TaxReportsPage() {
  return (
    <RequireWallet>
      <TaxReports />
    </RequireWallet>
  )
}
