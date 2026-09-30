import { TaxReports } from '@/screens/TaxReports'
import { RequireWallet } from '@/wallet/RequireWallet'

export default function TaxReportsPage() {
  return (
    <RequireWallet>
      <TaxReports />
    </RequireWallet>
  )
}
