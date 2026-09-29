'use client'

import { useEffect, useState } from 'react'
import { AdminConsole } from '@/screens/admin/AdminConsole'
import { useWallet, shortAddress } from '@/wallet/WalletProvider'
import { checkIsAdmin } from '@/wallet/admin'
import { Button, Card } from '@/components'

export default function AdminPage() {
  const { connected, address, connect, disconnect } = useWallet()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!connected || !address) {
      setIsAdmin(false)
      setChecking(false)
      return
    }

    let active = true
    setChecking(true)

    checkIsAdmin(address)
      .then((allowed) => {
        if (active) setIsAdmin(allowed)
      })
      .catch(() => {
        if (active) setIsAdmin(false)
      })
      .finally(() => {
        if (active) setChecking(false)
      })

    return () => {
      active = false
    }
  }, [connected, address])

  if (!connected) {
    return (
      <main
        id="main-content"
        style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px' }}
      >
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <div className="hb-eyebrow" style={{ marginBottom: 12 }}>
            Privileged Area
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--type-h3)',
              color: 'var(--ink)',
              margin: '0 0 12px',
            }}
          >
            Admin Authentication Required
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-data)',
              color: 'var(--ink-60)',
              lineHeight: 1.55,
              margin: '0 0 24px',
            }}
          >
            Access to this console is restricted to authorized contract owners and administrators.
            Please connect an administrator wallet to proceed.
          </p>
          <Button variant="primary" size="lg" onClick={() => void connect()}>
            Connect wallet
          </Button>
        </Card>
      </main>
    )
  }

  if (checking || isAdmin === null) {
    return (
      <main
        id="main-content"
        style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px', textAlign: 'center' }}
      >
        <div style={{ fontFamily: 'var(--font-body)', color: 'var(--ink-60)' }}>
          Verifying administrative privileges...
        </div>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main
        id="main-content"
        style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px' }}
      >
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              background: 'rgba(179,54,27,0.1)',
              color: 'var(--ember)',
              fontFamily: 'var(--font-data)',
              fontWeight: 700,
              fontSize: 'var(--type-caption)',
              marginBottom: 16,
            }}
          >
            403 Forbidden
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--type-h3)',
              color: 'var(--ink)',
              margin: '0 0 12px',
            }}
          >
            Access Denied
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-data)',
              color: 'var(--ink-60)',
              lineHeight: 1.55,
              margin: '0 0 24px',
            }}
          >
            Connected wallet <strong style={{ color: 'var(--ink)' }}>{shortAddress(address ?? '')}</strong> is not an authorized administrator on this contract.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Button variant="secondary" onClick={() => disconnect()}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={() => void connect()}>
              Switch wallet
            </Button>
          </div>
        </Card>
      </main>
    )
  }

  return (
    <main id="main-content" style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 64px' }}>
      <AdminConsole />
    </main>
  )
}
