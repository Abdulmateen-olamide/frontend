'use client'

import { memo, useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button, StatBlock, LiquidityMeter, Card, AddressChip, useToast } from '../components'
import { Helio } from '../brand/Helio'
import { selectActivity, selectYou } from '../state/selectors'
import { useWallet } from '../wallet/WalletProvider'
import { getPendingClaims, removePendingClaim, type PendingClaim } from '../wallet/pendingClaims'
import { submitClaim } from '../wallet/vault'
import { formatDecimal } from '../lib/format'
import { OnChainPosition } from './OnChainPosition'

const MemoizedHelio = memo(Helio)

const MemoizedLiquidityMeter = memo(LiquidityMeter)

/**
 * Portfolio — calm dashboard. Headline value with delta since deposit, the
 * personal mini-Helio, and three always-visible figures including the permanent
 * "Available to withdraw now" liquidity truth.
 */
export interface PortfolioProps {
  onWithdraw: () => void
  onDeposit: () => void
}

export const Portfolio = memo(function Portfolio({ onWithdraw, onDeposit }: PortfolioProps) {
  const t = useTranslations('Portfolio')
  const { connected, connect, address, sign } = useWallet()
  const { toast } = useToast()
  // Flat selectors — one level, no drilling through the nested state shape.
  const you = selectYou()
  const activity = selectActivity()
  const risk = { score: you.riskScore, level: you.riskLevel }
  const referralLink = you.referralLink

  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([])
  const [claiming, setClaiming] = useState(false)

  const refreshClaims = useCallback(() => {
    setPendingClaims(getPendingClaims(address ?? undefined))
  }, [address])

  useEffect(() => {
    refreshClaims()
  }, [refreshClaims])

  const handleClaim = async () => {
    setClaiming(true)
    try {
      await submitClaim(address ?? '', sign)
      pendingClaims.forEach((c) => removePendingClaim(c.hash))
      refreshClaims()
      toast({
        tone: 'success',
        title: 'Withdrawals claimed',
        message: 'Queued withdrawals claimed successfully and paid out in USDC.',
      })
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Claim failed',
        message: e instanceof Error ? e.message : 'Could not process claim at this time.',
      })
    } finally {
      setClaiming(false)
    }
  }

  if (!connected) {
    return (
      <main
        id="main-content"
        style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px 80px' }}
      >
        <Card
          style={{
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <div className="hb-eyebrow">{t('eyebrow')}</div>
          <h2 style={{ ...cardTitle, margin: 0 }}>Connect your wallet to view your portfolio</h2>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-small)',
              lineHeight: 1.5,
              color: 'var(--ink-60)',
              margin: 0,
            }}
          >
            Your holdings and activity will appear here after you connect.
          </p>
          <Button variant="primary" onClick={() => void connect()}>
            Connect wallet
          </Button>
        </Card>
      </main>
    )
  }

  return (
    <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px 80px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 24,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div>
          <div className="hb-eyebrow" style={{ marginBottom: 14 }}>
            {t('eyebrow')}
          </div>
          <StatBlock
            label={t('currentValue')}
            value={`$${Math.floor(you.value).toLocaleString('en-US')}`}
            decimals={`.${String(you.value).split('.')[1] ?? '00'}`}
            delta={`+$${you.deltaAbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${you.deltaPct}%) ${t('sinceDeposit')}`}
            size="lg"
            stackOnMobile
          />
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-caption)',
              color: 'var(--ink-60)',
              marginTop: 4,
            }}
          >
            Includes $320 pending/escrow investments awaiting verification — total reflects settled
            + pending.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <MemoizedHelio size={108} motes={you.backed} />
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={onWithdraw}>
              {t('withdraw')}
            </Button>
            <Button variant="primary" onClick={onDeposit}>
              {t('investMore')}
            </Button>
          </div>
        </div>
      </div>

      {/* three always-visible figures */}
      <div className="hb-figures-grid" style={{ margin: '28px 0' }}>
        <Card style={{ padding: 22 }}>
          <StatBlock label={t('hbsHeld')} value="24,041" decimals=".2310" size="md" />
        </Card>
        <Card style={{ padding: 22 }}>
          <StatBlock label={t('poolShare')} value="0.49" unit="%" size="md" />
        </Card>
        <Card style={{ padding: 22 }}>
          <MemoizedLiquidityMeter liquid={236} total={482} currency="$" showExplanation={false} />
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-eyebrow)',
              color: 'var(--ink-60)',
              margin: '8px 0 0',
            }}
          >
            {t('liquidCaption')}
          </p>
        </Card>
      </div>

      <OnChainPosition />

      {/* Pending queued withdrawals */}
      <Card style={{ padding: 22, marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: pendingClaims.length > 0 ? 16 : 0,
          }}
        >
          <div>
            <h3 style={cardTitle}>Pending withdrawals</h3>
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--type-small)',
                color: 'var(--ink-60)',
                margin: '4px 0 0',
              }}
            >
              {pendingClaims.length > 0
                ? `${pendingClaims.length} queued FIFO claim${pendingClaims.length > 1 ? 's' : ''} awaiting vault liquidity.`
                : 'No queued withdrawals. Immediate liquidity is available for standard payouts.'}
            </p>
          </div>
          {pendingClaims.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={claiming}
              onClick={handleClaim}
            >
              {claiming ? 'Claiming...' : 'Claim available liquidity'}
            </Button>
          )}
        </div>
        {pendingClaims.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingClaims.map((claim) => (
              <div
                key={claim.id || claim.hash}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: 'var(--ink-04)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--ink-12)',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-data)',
                      fontSize: 'var(--type-small)',
                      fontWeight: 600,
                      color: 'var(--solar)',
                      background: 'rgba(234, 179, 8, 0.15)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-pill)',
                    }}
                  >
                    Queue #{claim.position}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-data)',
                      fontSize: 'var(--type-body)',
                      fontWeight: 600,
                      color: 'var(--ink)',
                    }}
                  >
                    ${formatDecimal(claim.amount, 2)} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 'var(--type-caption)',
                      color: 'var(--ink-60)',
                    }}
                  >
                    {new Date(claim.timestamp).toLocaleDateString()}
                  </span>
                  <AddressChip value={claim.hash} label="transaction hash" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Portfolio risk indicator from bond ratings mix */}
      <Card style={{ padding: 22, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <StatBlock
            label="Portfolio risk"
            value={risk.level[0].toUpperCase() + risk.level.slice(1)}
            size="md"
          />
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-small)',
              lineHeight: 1.55,
              color: 'var(--ink-60)',
              margin: 0,
            }}
          >
            Score: {risk.score}/100 based on bond ratings mix.
          </p>
        </div>
      </Card>
      {referralLink ? (
        <Card style={{ padding: 22, marginBottom: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <StatBlock label="Referral program" value={referralLink} size="sm" />
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(referralLink)}
            >
              Share
            </Button>
          </div>
        </Card>
      ) : null}

      {referralLink && (
        <Card style={{ padding: 22, marginBottom: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <h3 style={cardTitle}>{t('referralProgram')}</h3>
              <p
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--type-small)',
                  lineHeight: 1.55,
                  color: 'var(--ink-60)',
                  margin: '4px 0 0',
                }}
              >
                {t('referralCaption')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                readOnly
                value={referralLink}
                style={{
                  flex: '1 1 280px',
                  padding: '10px 14px',
                  fontFamily: 'var(--font-data)',
                  fontSize: 'var(--type-small)',
                  background: 'var(--ink-04)',
                  border: '1px solid var(--ink-12)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--ink)',
                  outline: 'none',
                }}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(referralLink ?? '')
                }}
              >
                {t('copyLink')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="hb-portfolio-grid">
        {/* Impact */}
        <Card style={{ padding: 22 }}>
          <h3 style={cardTitle}>{t('impactTitle')}</h3>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--type-small)',
              lineHeight: 1.55,
              color: 'var(--ink-60)',
              margin: '0 0 16px',
            }}
          >
            {t.rich('impactBody', {
              b: (c: ReactNode) => <b style={{ color: 'var(--ink)' }}>{c}</b>,
              count: you.backed,
            })}
          </p>
          <div style={{ display: 'flex', gap: 24 }}>
            <StatBlock label={t('projectsBacked')} value={String(you.backed)} size="sm" />
            <StatBlock label={t('weightedGreen')} value="88" size="sm" />
          </div>
        </Card>

        {/* Activity */}
        <Card style={{ minWidth: 0, padding: 22 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h3 style={cardTitle}>{t('activityTitle')}</h3>
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--type-caption)',
                color: 'var(--ink-40)',
              }}
            >
              {t('activityNote')}
            </span>
          </div>
          {activity.map((a, i) => (
            <div
              key={a.hash}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '12px 0',
                borderTop: i ? '1px solid var(--ink-12)' : 'none',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--type-small)',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {a.kind}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--type-caption)',
                    color: 'var(--ink-60)',
                  }}
                >
                  {a.amount}
                  {a.shares ? ` · ${a.shares}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--type-caption)',
                    color: 'var(--ink-60)',
                  }}
                >
                  {a.when}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-data)',
                    fontSize: 'var(--type-eyebrow)',
                    color: 'var(--ink-40)',
                  }}
                >
                  {a.hash} ↗
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </main>
  )
})

const cardTitle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 'var(--type-body-lg)',
  margin: '0 0 10px',
  color: 'var(--ink)',
}
