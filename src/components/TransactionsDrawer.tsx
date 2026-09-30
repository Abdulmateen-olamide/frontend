'use client'

import { useEffect, useRef } from 'react'
import { AddressChip } from './AddressChip'
import { useTransactions, type TransactionItem } from '../wallet/TransactionsProvider'
import { getExplorerTxUrl } from '../config/network'

export interface TransactionsDrawerProps {
  open: boolean
  onClose: () => void
}

export function TransactionsDrawer({ open, onClose }: TransactionsDrawerProps) {
  const { transactions, pendingCount, clearCompleted } = useTransactions()

  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')
      if (!nodes?.length) return
      const first = nodes[0],
        last = nodes[nodes.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      previous?.focus()
    }
  }, [open, onClose])
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer Panel */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction Activity"
        tabIndex={-1}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--ink-12)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.2)',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--ink-12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--type-h3)',
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              Transaction Activity
            </h2>
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--type-caption)',
                color: 'var(--ink-60)',
              }}
            >
              {pendingCount > 0
                ? `${pendingCount} pending transaction${pendingCount > 1 ? 's' : ''}`
                : 'Session transaction history'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity panel"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: 'var(--ink-60)',
            }}
          >
            &times;
          </button>
        </div>

        {/* Content List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {transactions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: 'var(--ink-60)',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--type-small)',
              }}
            >
              No transactions recorded in this session.
            </div>
          ) : (
            transactions.map((tx) => <TransactionRow key={tx.hash} item={tx} />)
          )}
        </div>

        {/* Footer */}
        {transactions.length > 0 && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--ink-12)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={clearCompleted}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--type-caption)',
                fontWeight: 600,
                color: 'var(--ink-60)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Clear Completed
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TransactionRow({ item }: { item: TransactionItem }) {
  const timeAgo = formatTimeAgo(item.submittedAt)

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--ink-12)',
        background: 'var(--ink-03)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--type-small)',
            fontWeight: 600,
            textTransform: 'capitalize',
            color: 'var(--ink)',
          }}
        >
          {item.kind.replace('_', ' ')}
          {item.amount ? ` • ${item.amount} USDC` : ''}
        </span>
        <StatusBadge status={item.status} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 'var(--type-caption)',
          color: 'var(--ink-60)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span>Submitted {timeAgo}</span>
        {item.fee !== undefined && <span>Estimated maximum fee: {item.fee.toFixed(7)} XLM</span>}
      </div>

      {item.inclusionFee !== undefined && (
        <span>Inclusion fee: {item.inclusionFee.toFixed(7)} XLM</span>
      )}
      {item.resourceFee !== undefined && (
        <span>Resource fee: {item.resourceFee.toFixed(7)} XLM</span>
      )}
      <div style={{ marginTop: 4 }}>
        <AddressChip
          value={item.hash}
          explorerUrl={
            item.hash.startsWith('demo')
              ? undefined
              : item.network
                ? `https://stellar.expert/explorer/${item.network}/tx/${item.hash}`
                : getExplorerTxUrl(item.hash)
          }
          label="transaction hash"
        />
      </div>

      {item.error && (
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--type-caption)',
            color: 'var(--ember)',
          }}
        >
          {item.error}
        </span>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: TransactionItem['status'] }) {
  let label = 'Confirmed'
  let bg = 'rgba(34, 197, 94, 0.15)'
  let color = 'var(--growth)'

  if (status === 'pending') {
    label = 'Pending'
    bg = 'rgba(59, 130, 246, 0.15)'
    color = '#3b82f6'
  } else if (status === 'timeout_pending') {
    label = 'Still Pending'
    bg = 'rgba(234, 179, 8, 0.15)'
    color = '#eab308'
  } else if (status === 'failed') {
    label = 'Failed'
    bg = 'rgba(239, 68, 68, 0.15)'
    color = 'var(--ember)'
  }

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 'var(--radius-pill)',
        background: bg,
        color,
        fontFamily: 'var(--font-data)',
        fontSize: 'var(--type-caption)',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  )
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
