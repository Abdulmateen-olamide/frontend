/**
 * Regression tests for #595: a deliberate Disconnect must not leave the app
 * showing the offline banner on the next visit.
 *
 * The banner used to read a second localStorage key (`stellar-wallet-connected`)
 * that `disconnect()` never cleared, so the flag stayed true forever and the
 * banner appeared on every load after a manual disconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@/test/render'
import type { DisconnectReason } from '@/wallet/WalletProvider'

let walletState = { connected: false, lastDisconnectReason: null as DisconnectReason | null }

vi.mock('@/wallet/WalletProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/wallet/WalletProvider')>('@/wallet/WalletProvider')
  return {
    ...actual,
    useWallet: () => walletState,
  }
})

import { OfflineBanner } from './providers'

const setOnline = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  })
}

/** jsdom has no fetch by default; the banner probes Horizon on mount. */
const stubFetch = (ok: boolean) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503 }))
}

describe('OfflineBanner (#595)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setOnline(true)
    stubFetch(true)
    walletState = { connected: false, lastDisconnectReason: null }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays hidden after a deliberate disconnect (#595)', async () => {
    walletState = { connected: false, lastDisconnectReason: 'user' }
    render(<OfflineBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  /**
   * The exact reported bug: a stale flag left in localStorage by an earlier
   * session must not resurrect the banner on the next page load.
   */
  it('ignores a stale connected flag left behind by a previous session (#595)', async () => {
    localStorage.setItem('stellar-wallet-connected', 'true')
    walletState = { connected: false, lastDisconnectReason: 'user' }
    render(<OfflineBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('writes no connected flag of its own (#595)', async () => {
    walletState = { connected: true, lastDisconnectReason: null }
    const { unmount } = render(<OfflineBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    unmount()
    expect(localStorage.getItem('stellar-wallet-connected')).toBeNull()
  })

  it('warns when the session is lost unexpectedly, not by choice', async () => {
    walletState = { connected: false, lastDisconnectReason: 'lost' }
    render(<OfflineBanner />)
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
  })

  it('stays hidden while connected and online', async () => {
    walletState = { connected: true, lastDisconnectReason: null }
    render(<OfflineBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('warns on a network drop even while connected', async () => {
    walletState = { connected: true, lastDisconnectReason: null }
    setOnline(false)
    render(<OfflineBanner />)
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
  })

  it('warns when the Stellar node stops responding', async () => {
    stubFetch(false)
    walletState = { connected: true, lastDisconnectReason: null }
    render(<OfflineBanner />)
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
  })

  it('recovers once the node answers again', async () => {
    stubFetch(false)
    const { unmount } = render(<OfflineBanner />)
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
    unmount()

    stubFetch(true)
    render(<OfflineBanner />)
    await waitFor(() => expect(screen.queryByText(/offline/i)).not.toBeInTheDocument())
  })
})
