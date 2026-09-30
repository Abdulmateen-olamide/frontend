'use client'
import { useEffect, useState } from 'react'
import { estimateTransactionFee } from './vault'

export function useTransactionFee(
  kind: 'deposit' | 'withdraw',
  amount: number,
  address: string | null | undefined,
  slippage: number,
) {
  const key = `${kind}:${amount}:${address}:${slippage}`
  const [estimate, setEstimate] = useState<{ key: string; fee: number | null } | null>(null)
  useEffect(() => {
    if (!address || !Number.isFinite(amount) || amount <= 0) return
    let active = true
    const timer = setTimeout(() => {
      void estimateTransactionFee(kind, amount, address, slippage).then(
        (fee) => {
          if (active) setEstimate({ key, fee })
        },
        () => {
          if (active) setEstimate({ key, fee: null })
        },
      )
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [kind, amount, address, slippage, key])
  return estimate?.key === key ? estimate.fee : null
}
