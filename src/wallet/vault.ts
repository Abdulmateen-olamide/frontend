// InvestmentVault client — synchronous simulation + async on-chain reads.
//
// The sync `vault` object mirrors the Soroban vault's surface so deposit &
// withdraw screens can use it for immediate previews (demo / no-config mode).
//
// When NEXT_PUBLIC_VAULT_CONTRACT_ID is set, the async functions below read
// directly from the deployed Soroban contract via RPC:
//   fetchSharePrice / fetchTotalAssets  — view reads (Issue #1)
//   submitDeposit / submitWithdraw      — signed transactions (Issue #2)
//
// In demo mode (isDemo flag) or when env vars are absent, everything falls
// back gracefully — no errors surface to the user.

import { selectSharePrice } from '../state/selectors'
import {
  STELLAR_NETWORK,
  SOROBAN_RPC_URL as RPC_URL,
  HORIZON_URL,
} from '../config/network'

export interface WithdrawPreview {
  assets: number
  sharePrice: number
  networkFee: number
}

export interface WithdrawResult {
  hash: string
  queued: boolean
  position?: number
  estimatedAmount?: number
  toString(): string
}

export function createWithdrawResult(
  hash: string,
  queued: boolean,
  position?: number,
  estimatedAmount?: number,
): WithdrawResult {
  return {
    hash,
    queued,
    position,
    estimatedAmount,
    toString() {
      return this.hash
    },
  }
}
/** total_assets / total_supply. Constant in the mock; a live read on-chain. */
export const SHARE_PRICE = selectSharePrice()

/** Number of decimal places used when formatting share prices. */
export const SHARE_PRICE_DECIMALS = 7

/** Formats a share price with consistent precision across all screens. */
export function formatSharePrice(sharePrice: number): string {
  return sharePrice.toFixed(SHARE_PRICE_DECIMALS)
}

/** Simulated pending delay for deposit transactions in demo mode. */
export const SIMULATED_DEPOSIT_DELAY_MS = 2000

/** Simulated pending delay for withdraw transactions in demo mode. */
export const SIMULATED_WITHDRAW_DELAY_MS = 2000

export interface DepositPreview {
  shares: number
  sharePrice: number
  /** USDC; sub-cent on Stellar. */
  networkFee: number
}

export const vault = {
  sharePrice: () => SHARE_PRICE,

  /** convert_to_shares(usdc) — what you receive for a deposit. */
  convertToShares: (usdc: number): number => usdc / SHARE_PRICE,

  /** convert_to_assets(shares) — what shares are worth on withdraw. */
  convertToAssets: (shares: number): number => shares * SHARE_PRICE,

  previewDeposit: (usdc: number): DepositPreview => ({
    shares: usdc / SHARE_PRICE,
    sharePrice: SHARE_PRICE,
    networkFee: 0.00001,
  }),

  previewWithdraw: (usdc: number): WithdrawPreview => ({
    assets: usdc,
    sharePrice: SHARE_PRICE,
    networkFee: 0.00001,
  }),
}

// ---------------------------------------------------------------------------
// Async Soroban client
// ---------------------------------------------------------------------------

const CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID

/** Max time to wait for a Stellar RPC/Horizon response before treating it as offline. */
const RPC_TIMEOUT_MS = 5000
let cachedSharePrice = SHARE_PRICE
let cachedTotalAssets: number | null = null
let offline = false
const offlineListeners = new Set<(offline: boolean) => void>()

function setOffline(nextOffline: boolean) {
  if (offline === nextOffline) return
  offline = nextOffline
  offlineListeners.forEach((listener) => {
    try {
      listener(nextOffline)
    } catch {
      // Listener errors must not break network timeout fallbacks.
    }
  })
}

/** Returns true when the last Stellar network call timed out. */
export function isOffline(): boolean {
  return offline
}

/** Subscribe to offline status changes. Returns an unsubscribe function. */
export function onOfflineChange(listener: (offline: boolean) => void): () => void {
  offlineListeners.add(listener)
  return () => {
    offlineListeners.delete(listener)
  }
}

/** Reject if a Stellar network call takes longer than RPC_TIMEOUT_MS. */
async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        setOffline(true)
        reject(new Error(message))
      }, RPC_TIMEOUT_MS)
    })
    const result = await Promise.race([promise, timeout])
    setOffline(false)
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Call a Soroban view function (no state mutation) and return the raw ScVal. */
async function sorobanSimulate(
  sourceAddress: string,
  method: string,
  args: unknown[] = [],
  network = STELLAR_NETWORK,
) {
  const { rpc, Contract, TransactionBuilder, Networks, Account, nativeToScVal } =
    await import('@stellar/stellar-sdk')

  const rpcUrl =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
    (network === 'testnet' ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org')
  const server = new rpc.Server(rpcUrl, { allowHttp: false })
  const contract = new Contract(CONTRACT_ID!)
  // Sequence '0' is fine for simulation — only the address format matters.
  const source = new Account(sourceAddress, '0')
  const scArgs = args.map((a) => nativeToScVal(a))
  const networkPassphrase = network === 'public' ? Networks.PUBLIC : Networks.TESTNET

  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(0)
    .build()

  const result = await withTimeout(
    server.simulateTransaction(tx),
    'Stellar RPC timed out during simulation',
  ) as { error?: string; result?: { retval: unknown } }
  if ('error' in result) {
    const error = result.error
    // Distinguish programming errors (bad address, bad args) from network errors
    // Invalid address/contract errors should NOT mark the app as offline
    const isProgrammingError =
      typeof error === 'string' &&
      (error.includes('Invalid address') ||
        error.includes('invalid address') ||
        error.includes('Malformed') ||
        error.includes('malformed') ||
        error.includes('Contract not found') ||
        error.includes('contract not found') ||
        error.includes('not a valid'))
    if (isProgrammingError) {
      throw new Error(`Soroban simulate error: ${error}`)
    }
    throw new Error(`Soroban simulate error: ${error}`)
  }
  if (!result.result) throw new Error('Soroban simulate returned no result')
  return result.result.retval
}

/**
 * Read share price from the on-chain vault using convert_to_assets(10^7).
 * Throws when NEXT_PUBLIC_VAULT_CONTRACT_ID is not set — callers should catch
 * and fall back to the mock value.
 */
export async function fetchSharePrice(
  sourceAddress: string,
  network = STELLAR_NETWORK,
): Promise<string> {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_VAULT_CONTRACT_ID not set')
  if (offline) return formatSharePrice(cachedSharePrice)
  const { scValToNative, nativeToScVal } = await import('@stellar/stellar-sdk')
  try {
    // InvestmentVault doesn't have share_price(), compute from convert_to_assets(1 share = 10^7 stroops)
    const oneShare = nativeToScVal(BigInt(10 ** SHARE_PRICE_DECIMALS), { type: 'i128' })
    const retval = await sorobanSimulate(sourceAddress, 'convert_to_assets', [oneShare], network)
    cachedSharePrice = Number(scValToNative(retval)) / 10 ** SHARE_PRICE_DECIMALS
    return formatSharePrice(cachedSharePrice)
  } catch (e) {
    // Don't mark offline for programming errors (invalid address, bad contract, etc.)
    const msg = e instanceof Error ? e.message : String(e)
    const isProgrammingError =
      msg.includes('Invalid address') ||
      msg.includes('invalid address') ||
      msg.includes('Malformed') ||
      msg.includes('malformed') ||
      msg.includes('Contract not found') ||
      msg.includes('contract not found') ||
      msg.includes('not a valid')
    if (!isProgrammingError) {
      setOffline(true)
    }
    return formatSharePrice(cachedSharePrice)
  }
}

/**
 * Read total_assets from the on-chain vault.
 * Throws when NEXT_PUBLIC_VAULT_CONTRACT_ID is not set.
 */
export async function fetchTotalAssets(
  sourceAddress: string,
  network = STELLAR_NETWORK,
): Promise<number> {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_VAULT_CONTRACT_ID not set')
  if (offline) return cachedTotalAssets ?? 0
  const { scValToNative } = await import('@stellar/stellar-sdk')
  try {
    const retval = await sorobanSimulate(sourceAddress, 'total_assets', [], network)
    cachedTotalAssets = Number(scValToNative(retval))
    return cachedTotalAssets
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isProgrammingError =
      msg.includes('Invalid address') ||
      msg.includes('invalid address') ||
      msg.includes('Malformed') ||
      msg.includes('malformed') ||
      msg.includes('Contract not found') ||
      msg.includes('contract not found') ||
      msg.includes('not a valid')
    if (!isProgrammingError) {
      setOffline(true)
    }
    return cachedTotalAssets ?? 0
  }
}

/**
 * Read vault utilization in basis points (10000 = 100%).
 * Returns 0 when not available.
 */
export async function fetchUtilizationBps(
  sourceAddress: string,
  network = STELLAR_NETWORK,
): Promise<number> {
  if (!CONTRACT_ID) return 0
  if (offline) return 0
  const { scValToNative } = await import('@stellar/stellar-sdk')
  try {
    const retval = await sorobanSimulate(sourceAddress, 'get_utilization_bps', [], network)
    return Number(scValToNative(retval))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isProgrammingError =
      msg.includes('Invalid address') ||
      msg.includes('invalid address') ||
      msg.includes('Malformed') ||
      msg.includes('malformed') ||
      msg.includes('Contract not found') ||
      msg.includes('contract not found') ||
      msg.includes('not a valid')
    if (!isProgrammingError) {
      setOffline(true)
    }
    return 0
  }
}

// ---------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------

/** Seconds to poll getTransaction before giving up */
const TX_POLL_TIMEOUT_S = 30

export interface TransactionConfirmation {
  status: string
  resultMetaXdr?: string
  returnValue?: unknown
}

/** Poll until a submitted transaction reaches a terminal status. */
async function waitForTransaction(hash: string): Promise<TransactionConfirmation> {
  const { rpc } = await import('@stellar/stellar-sdk')
  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const deadline = Date.now() + TX_POLL_TIMEOUT_S * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const result = await withTimeout(
      server.getTransaction(hash),
      'Stellar RPC timed out while polling transaction status',
    )
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return result as unknown as TransactionConfirmation
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error('Transaction failed on-chain')
    }
    // NOT_FOUND means still pending, keep polling
  }
  throw new Error('Transaction confirmation timed out')
}

/**
 * Build, sign, and submit a deposit transaction.
 * In demo mode (CONTRACT_ID not set): waits 2 s then returns a placeholder hash.
 *
 * @param amount  USDC amount (integer stroops internally)
 * @param address Stellar address of the depositor (source account)
 * @param sign    Signing function from WalletProvider
 * @param slippageTolerance  Slippage tolerance as decimal (e.g., 0.005 = 0.5%)
 * @returns       Transaction hash (real or placeholder)
 */
export async function submitDeposit(
  amount: number,
  address: string,
  sign: (xdr: string) => Promise<string>,
  signal?: AbortSignal,
  slippageTolerance = 0.005,
): Promise<string> {
  if (!CONTRACT_ID) {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(
          `demo${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}…${Math.random().toString(36).slice(2, 8)}`,
        )
      }, SIMULATED_DEPOSIT_DELAY_MS)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        })
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        }
      }
    })
  }

  if (offline) throw new Error('Stellar node is offline')

  const { rpc, Contract, TransactionBuilder, Networks, Horizon, nativeToScVal, Transaction } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const horizon = new Horizon.Server(HORIZON_URL)
  const contract = new Contract(CONTRACT_ID)

  const account = await withTimeout(
    horizon.loadAccount(address),
    'Stellar Horizon timed out loading account',
  )
  // USDC uses 7 decimal places on Stellar (stroops-equivalent for SAC tokens).
  // The contract expects the raw integer amount scaled by 10^7.
  const amountScVal = nativeToScVal(BigInt(Math.round(amount * 1e7)), { type: 'i128' })
  // Compute min_shares from preview: shares = amount / share_price, then apply slippage
  const previewShares = amount / cachedSharePrice
  const minShares = Math.floor(previewShares * (1 - slippageTolerance) * 1e7)
  const minSharesScVal = nativeToScVal(BigInt(minShares), { type: 'i128' })
  const networkPassphrase = STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET

  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase })
    .addOperation(contract.call('deposit', amountScVal, minSharesScVal))
    .setTimeout(180)
    .build()

  const simResult = await withTimeout(
    server.simulateTransaction(tx),
    'Stellar RPC timed out during simulation',
  ) as { error?: string; result?: unknown }
  if ('error' in simResult) throw new Error(`Simulation failed: ${simResult.error}`)

  const assembled = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await sign(assembled.toXDR())
  const signedTx = new Transaction(signedXdr, networkPassphrase)

  const sendResult = await withTimeout(
    server.sendTransaction(signedTx),
    'Stellar RPC timed out submitting transaction',
  ) as { status: string; hash: string; errorResult?: unknown }
  if (sendResult.status === 'ERROR')
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`)

  await waitForTransaction(sendResult.hash)
  return sendResult.hash
}

/**
 * Build, sign, and submit a withdraw transaction.
 * Reads events after confirmation to detect queued withdrawals (WithdrawQueued).
 * In demo mode (CONTRACT_ID not set): returns a WithdrawResult with demo hash.
 * If amount exceeds liquid share (236), enqueues the withdrawal.
 *
 * @param amount  USDC amount to withdraw
 * @param address Stellar address of the withdrawer
 * @param sign    Signing function from WalletProvider
 * @param slippageTolerance  Slippage tolerance as decimal (e.g., 0.005 = 0.5%)
 * @returns       WithdrawResult with hash and queued status
 */
export async function submitWithdraw(
  amount: number,
  address: string,
  sign: (xdr: string) => Promise<string>,
  signal?: AbortSignal,
  slippageTolerance = 0.005,
): Promise<WithdrawResult> {
  if (!CONTRACT_ID) {
    return new Promise<WithdrawResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const demoHash = `demo${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}…${Math.random().toString(36).slice(2, 8)}`
        const isQueued = amount > 236
        resolve(createWithdrawResult(demoHash, isQueued, isQueued ? 1 : undefined, amount))
      }, SIMULATED_WITHDRAW_DELAY_MS)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        })
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        }
      }
    })
  }

  if (offline) throw new Error('Stellar node is offline')

  const { rpc, Contract, TransactionBuilder, Networks, Horizon, nativeToScVal, Transaction, xdr, scValToNative } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const horizon = new Horizon.Server(HORIZON_URL)
  const contract = new Contract(CONTRACT_ID)

  const account = await withTimeout(
    horizon.loadAccount(address),
    'Stellar Horizon timed out loading account',
  )
  // Convert USDC amount to shares (shares = amount / share_price * 1e7)
  const shares = Math.round((amount / cachedSharePrice) * 1e7)
  const sharesScVal = nativeToScVal(BigInt(shares), { type: 'i128' })
  // Compute min_usdc_return from preview with slippage tolerance
  const minUsdcReturn = Math.floor(amount * (1 - slippageTolerance) * 1e7)
  const minAssetsScVal = nativeToScVal(BigInt(minUsdcReturn), { type: 'i128' })
  const networkPassphrase = STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET

  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase })
    .addOperation(contract.call('withdraw', sharesScVal, minAssetsScVal))
    .setTimeout(180)
    .build()

  const simResult = await withTimeout(
    server.simulateTransaction(tx),
    'Stellar RPC timed out during simulation',
  ) as { error?: string; result?: unknown }
  if ('error' in simResult) throw new Error(`Simulation failed: ${simResult.error}`)

  const assembled = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await sign(assembled.toXDR())
  const signedTx = new Transaction(signedXdr, networkPassphrase)

  const sendResult = await withTimeout(
    server.sendTransaction(signedTx),
    'Stellar RPC timed out submitting transaction',
  ) as { status: string; hash: string; errorResult?: unknown }
  if (sendResult.status === 'ERROR')
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`)

  const conf = await waitForTransaction(sendResult.hash)
  let queued = false
  let position: number | undefined
  let estimatedAmount = amount

  const inspectEvent = (rawEvt: unknown) => {
    try {
      const anyEvt = rawEvt as {
        event?: () => unknown
        body?: () => {
          v0?: () => {
            topics?: () => unknown[]
            data?: () => unknown
          }
        }
      }
      const contractEvt = (typeof anyEvt.event === 'function' ? anyEvt.event() : anyEvt) as {
        body?: () => {
          v0?: () => {
            topics?: () => unknown[]
            data?: () => unknown
          }
        }
      }
      const body = typeof contractEvt.body === 'function' ? contractEvt.body() : undefined
      const v0 = typeof body?.v0 === 'function' ? body.v0() : undefined
      if (!v0) return

      const topics = typeof v0.topics === 'function' ? v0.topics() ?? [] : []
      const topicStrs = topics.map((t) => {
        try {
          return String(scValToNative(t as Parameters<typeof scValToNative>[0]))
        } catch {
          return ''
        }
      })

      if (
        topicStrs.some((s) => {
          const lower = s.toLowerCase()
          return lower.includes('withdrawqueued') || lower.includes('withdraw_queued')
        })
      ) {
        queued = true
        try {
          const dataVal = typeof v0.data === 'function' ? v0.data() : undefined
          if (!dataVal) return
          const rawData = scValToNative(dataVal as Parameters<typeof scValToNative>[0])
          if (rawData && typeof rawData === 'object') {
            const record = rawData as Record<string, unknown>
            if ('position' in record) position = Number(record.position)
            if ('amount' in record) estimatedAmount = Number(record.amount) / 1e7
          } else if (typeof rawData === 'bigint' || typeof rawData === 'number') {
            position = Number(rawData)
          }
        } catch {
          /* ignore payload parse error */
        }
      }
    } catch {
      /* ignore event inspect error */
    }
  }

  const anyConf = conf as unknown as {
    resultMetaXdr?: unknown
    returnValue?: unknown
    diagnosticEventsXdr?: unknown[]
    events?: { contractEventsXdr?: unknown[][] }
  }

  // 1. Inspect contract events array from RPC response
  if (anyConf.events?.contractEventsXdr && Array.isArray(anyConf.events.contractEventsXdr)) {
    for (const group of anyConf.events.contractEventsXdr) {
      if (Array.isArray(group)) {
        for (const evt of group) inspectEvent(evt)
      }
    }
  }

  // 2. Inspect diagnostic events
  if (anyConf.diagnosticEventsXdr && Array.isArray(anyConf.diagnosticEventsXdr)) {
    for (const diag of anyConf.diagnosticEventsXdr) inspectEvent(diag)
  }

  // 3. Inspect resultMetaXdr (both parsed object and base64 string)
  if (anyConf.resultMetaXdr) {
    try {
      let meta: unknown = anyConf.resultMetaXdr
      if (typeof meta === 'string') {
        meta = xdr.TransactionMeta.fromXDR(meta, 'base64')
      }
      const typedMeta = meta as {
        v3?: () => { sorobanMeta?: () => { events?: () => unknown[] } }
        switch?: () => number
        value?: () => { sorobanMeta?: () => { events?: () => unknown[] } }
      }
      const v3 = typedMeta.v3?.() || (typedMeta.switch?.() === 3 || typedMeta.switch?.() === 4 ? typedMeta.value?.() : null)
      const events = v3?.sorobanMeta?.()?.events?.() ?? []
      for (const evt of events) inspectEvent(evt)
    } catch {
      /* ignore meta parse error */
    }
  }

  // 4. Inspect return value if contract returns QueuedClaim struct or status
  if (anyConf.returnValue) {
    try {
      const ret = scValToNative(anyConf.returnValue as Parameters<typeof scValToNative>[0])
      if (ret && typeof ret === 'object') {
        const record = ret as Record<string, unknown>
        if ('queued' in record && Boolean(record.queued)) queued = true
        if ('position' in record) position = Number(record.position)
        if ('amount' in record) estimatedAmount = Number(record.amount) / 1e7
      }
    } catch {
      /* ignore return value parse error */
    }
  }

  return createWithdrawResult(sendResult.hash, queued, position ?? (queued ? 1 : undefined), estimatedAmount)
}

/**
 * Call permissionless claim() on the InvestmentVault to pay out queued withdrawals.
 */
export async function submitClaim(
  address: string,
  sign: (xdr: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  if (!CONTRACT_ID) {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(
          `demo${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}…${Math.random().toString(36).slice(2, 8)}`,
        )
      }, 1500)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        })
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        }
      }
    })
  }

  if (offline) throw new Error('Stellar node is offline')

  const { rpc, Contract, TransactionBuilder, Networks, Horizon, Transaction, Address } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const horizon = new Horizon.Server(HORIZON_URL)
  const contract = new Contract(CONTRACT_ID)

  const account = await withTimeout(
    horizon.loadAccount(address),
    'Stellar Horizon timed out loading account',
  )
  const networkPassphrase = STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET

  let tx = new TransactionBuilder(account, { fee: '100', networkPassphrase })
    .addOperation(contract.call('claim'))
    .setTimeout(180)
    .build()

  let simResult = await withTimeout(
    server.simulateTransaction(tx),
    'Stellar RPC timed out during simulation',
  ) as { error?: string; result?: unknown }

  // If parameterless claim() fails simulation, try passing claimant address
  if ('error' in simResult) {
    try {
      const userScVal = new Address(address).toScVal()
      const fallbackTx = new TransactionBuilder(account, { fee: '100', networkPassphrase })
        .addOperation(contract.call('claim', userScVal))
        .setTimeout(180)
        .build()
      const fallbackSim = await withTimeout(
        server.simulateTransaction(fallbackTx),
        'Stellar RPC timed out during simulation',
      ) as { error?: string; result?: unknown }
      if (!('error' in fallbackSim)) {
        tx = fallbackTx
        simResult = fallbackSim
      }
    } catch {
      /* ignore fallback error and report original error */
    }
  }

  if ('error' in simResult) throw new Error(`Simulation failed: ${simResult.error}`)

  const assembled = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await sign(assembled.toXDR())
  const signedTx = new Transaction(signedXdr, networkPassphrase)

  const sendResult = await withTimeout(
    server.sendTransaction(signedTx),
    'Stellar RPC timed out submitting transaction',
  ) as { status: string; hash: string; errorResult?: unknown }
  if (sendResult.status === 'ERROR')
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`)

  await waitForTransaction(sendResult.hash)
  return sendResult.hash
}