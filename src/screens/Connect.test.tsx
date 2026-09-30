import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/render'
import { Connect } from './Connect'

const mockWallet = {
  connectionError: null as string | null,
  connecting: false,
  syncing: false,
  retry: vi.fn(),
}

vi.mock('../wallet/WalletProvider', () => ({
  useWallet: () => mockWallet,
}))

describe('Connect screen - Wallet syncing indicator (#473)', () => {
  beforeEach(() => {
    mockWallet.connectionError = null
    mockWallet.connecting = false
    mockWallet.syncing = false
    mockWallet.retry.mockClear()
  })

  it('renders connect doors without syncing indicator when idle', () => {
    render(<Connect onWallet={vi.fn()} onNew={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByTestId('wallet-syncing-indicator')).toBeNull()
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
  })

  it('displays syncing indicator and loading state when syncing with Stellar', () => {
    mockWallet.connecting = true
    mockWallet.syncing = true

    render(<Connect onWallet={vi.fn()} onNew={vi.fn()} onCancel={vi.fn()} />)

    const indicator = screen.getByTestId('wallet-syncing-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveTextContent(/syncing with stellar/i)

    const button = screen.getByRole('button', { name: /syncing…/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})
