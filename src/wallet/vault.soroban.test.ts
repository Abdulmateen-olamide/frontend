// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Account,
  Keypair,
  StrKey,
  Transaction,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

// Soroban call-shape tests for src/wallet/vault.ts (#608). The real SDK builds
// and encodes every transaction; only the network edges (rpc.Server,
// Horizon.Server, assembleTransaction) are replaced, so these assertions see
// exactly the InvokeContract arguments the app would submit.

const rpcMock = vi.hoisted(() => ({
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  loadAccount: vi.fn(),
  serverOptions: [] as unknown[],
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  class Server {
    constructor(_url: string, opts?: unknown) {
      rpcMock.serverOptions.push(opts)
    }
    simulateTransaction = rpcMock.simulateTransaction
    sendTransaction = rpcMock.sendTransaction
    getTransaction = rpcMock.getTransaction
  }
  class HorizonServer {
    loadAccount = rpcMock.loadAccount
  }
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server,
      // The assembled tx only adds footprint/fees; the invocation is unchanged.
      assembleTransaction: (tx: unknown) => ({ build: () => tx }),
    },
    Horizon: { ...actual.Horizon, Server: HorizonServer },
  }
})

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7))
const USER = Keypair.random().publicKey()
const TESTNET = 'Test SDF Network ; September 2015'

type Vault = typeof import('./vault')

async function loadVault(contractId: string | null = CONTRACT_ID): Promise<Vault> {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_VAULT_CONTRACT_ID', contractId ?? '')
  return import('./vault')
}

/** The InvokeContract args of the single operation in a built transaction. */
function invocation(tx: Transaction) {
  const op = tx.operations[0] as { type: string; func: xdr.HostFunction }
  expect(op.type).toBe('invokeHostFunction')
  const call = op.func.invokeContract()
  return {
    contract: StrKey.encodeContract(call.contractAddress().contractId() as unknown as Buffer),
    method: call.functionName().toString(),
    argTypes: call.args().map((a) => a.switch().name),
    args: call.args().map((a) => scValToNative(a)),
  }
}

function simulatedTx(n = 0): Transaction {
  return rpcMock.simulateTransaction.mock.calls[n][0] as Transaction
}

function okSimulation(retval: xdr.ScVal = xdr.ScVal.scvVoid()) {
  return { result: { retval }, transactionData: {}, minResourceFee: '0', latestLedger: 1 }
}

/** Advance fake timers through confirmation polling while `run` settles. */
async function settle<T>(run: Promise<T>): Promise<T> {
  const guarded = run.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  )
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(2000)
  const res = await guarded
  if (!res.ok) throw res.e
  return res.v
}

const sign = vi.fn(async (txXdr: string) => txXdr)

beforeEach(() => {
  vi.useFakeTimers()
  rpcMock.simulateTransaction.mockReset().mockResolvedValue(okSimulation())
  rpcMock.sendTransaction.mockReset().mockResolvedValue({ status: 'PENDING', hash: 'abc123' })
  rpcMock.getTransaction.mockReset().mockResolvedValue({ status: 'SUCCESS' })
  rpcMock.loadAccount.mockReset().mockImplementation(async (id: string) => new Account(id, '41'))
  rpcMock.serverOptions.length = 0
  sign.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('signed transactions', () => {
  it('deposit(from: Address, usdc_amount: i128)', async () => {
    const vault = await loadVault()
    const hash = await settle(vault.submitDeposit(125.5, USER, sign))

    expect(hash).toBe('abc123')
    const call = invocation(simulatedTx())
    expect(call).toEqual({
      contract: CONTRACT_ID,
      method: 'deposit',
      argTypes: ['scvAddress', 'scvI128'],
      args: [USER, 1_255_000_000n],
    })
    // The simulated transaction is what gets signed and submitted.
    expect(sign).toHaveBeenCalledWith(simulatedTx().toXDR())
    const sent = rpcMock.sendTransaction.mock.calls[0][0] as Transaction
    expect(sent.networkPassphrase).toBe(TESTNET)
    expect(sent.source).toBe(USER)
    expect(invocation(sent).method).toBe('deposit')
    expect(rpcMock.getTransaction).toHaveBeenCalledWith('abc123')
  })

  it('withdraw(from: Address, shares_amount: i128, min_usdc_return: i128)', async () => {
    const vault = await loadVault()
    const result = await settle(vault.submitWithdraw(200, USER, sign))

    expect(result.hash).toBe('abc123')
    expect(result.queued).toBe(false)
    expect(invocation(simulatedTx())).toEqual({
      contract: CONTRACT_ID,
      method: 'withdraw',
      argTypes: ['scvAddress', 'scvI128', 'scvI128'],
      args: [USER, 2_000_000_000n, 0n],
    })
  })

  it('claim() takes no arguments', async () => {
    const vault = await loadVault()
    await expect(settle(vault.submitClaim(USER, sign))).resolves.toBe('abc123')
    expect(invocation(simulatedTx())).toMatchObject({ method: 'claim', argTypes: [], args: [] })
    expect(rpcMock.simulateTransaction).toHaveBeenCalledTimes(1)
  })

  it('claim_yield(from: Address)', async () => {
    const vault = await loadVault()
    await expect(settle(vault.submitClaimYield(USER, sign))).resolves.toBe('abc123')
    expect(invocation(simulatedTx())).toMatchObject({
      method: 'claim_yield',
      argTypes: ['scvAddress'],
      args: [USER],
    })
  })

  it('scales amounts to 7-decimal i128 without float drift', async () => {
    const vault = await loadVault()
    await settle(vault.submitDeposit(0.1 + 0.2, USER, sign))
    expect(invocation(simulatedTx()).args[1]).toBe(3_000_000n)
    expect(vault.toStroops(1)).toBe(10_000_000n)
  })

  it('detects a queued withdrawal from the WithdrawQueued event', async () => {
    const vault = await loadVault()
    const event = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [nativeToScVal('WithdrawQueued', { type: 'symbol' })],
          data: nativeToScVal({ position: 3, amount: 5_000_000_000n }),
        }),
      ),
    })
    rpcMock.getTransaction.mockResolvedValue({
      status: 'SUCCESS',
      events: { contractEventsXdr: [[event]] },
    })

    const result = await settle(vault.submitWithdraw(500, USER, sign))
    expect(result).toMatchObject({
      hash: 'abc123',
      queued: true,
      position: 3,
      estimatedAmount: 500,
    })
    expect(String(result)).toBe('abc123')
  })

  it('does not ask the wallet to sign when simulation fails', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue({ error: 'HostError: Error(Contract, #12)' })
    await expect(settle(vault.submitDeposit(100, USER, sign))).rejects.toThrow(
      'Simulation failed: HostError: Error(Contract, #12)',
    )
    expect(sign).not.toHaveBeenCalled()
    expect(rpcMock.sendTransaction).not.toHaveBeenCalled()
  })

  it('surfaces a rejected submission', async () => {
    const vault = await loadVault()
    rpcMock.sendTransaction.mockResolvedValue({
      status: 'ERROR',
      hash: 'x',
      errorResult: 'txBadSeq',
    })
    await expect(settle(vault.submitWithdraw(100, USER, sign))).rejects.toThrow(
      'Send failed: "txBadSeq"',
    )
  })

  it('surfaces an on-chain failure', async () => {
    const vault = await loadVault()
    rpcMock.getTransaction.mockResolvedValue({ status: 'FAILED' })
    await expect(settle(vault.submitClaim(USER, sign))).rejects.toThrow(
      'Transaction failed on-chain',
    )
  })

  it('keeps polling while the transaction is NOT_FOUND', async () => {
    const vault = await loadVault()
    rpcMock.getTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValue({ status: 'SUCCESS' })
    await settle(vault.submitDeposit(100, USER, sign))
    expect(rpcMock.getTransaction).toHaveBeenCalledTimes(3)
  })

  it('gives up when confirmation never arrives', async () => {
    const vault = await loadVault()
    rpcMock.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' })
    await expect(settle(vault.submitDeposit(100, USER, sign))).rejects.toThrow(
      'Transaction confirmation timed out',
    )
  })

  it('goes offline when Horizon does not answer, and refuses further submissions', async () => {
    const vault = await loadVault()
    const listener = vi.fn()
    const unsubscribe = vault.onOfflineChange(listener)
    rpcMock.loadAccount.mockReturnValue(new Promise(() => {}))

    await expect(settle(vault.submitDeposit(100, USER, sign))).rejects.toThrow(
      'Stellar Horizon timed out loading account',
    )
    expect(vault.isOffline()).toBe(true)
    expect(listener).toHaveBeenCalledWith(true)
    await expect(vault.submitWithdraw(100, USER, sign)).rejects.toThrow('Stellar node is offline')
    unsubscribe()
  })

  it('uses HTTPS-only RPC clients for the default endpoints', async () => {
    const vault = await loadVault()
    await settle(vault.submitDeposit(100, USER, sign))
    expect(rpcMock.serverOptions).toContainEqual({ allowHttp: false })
  })
})

describe('demo mode (no contract configured)', () => {
  it.each([
    ['submitDeposit', (v: Vault) => v.submitDeposit(50, USER, sign)],
    ['submitClaim', (v: Vault) => v.submitClaim(USER, sign)],
    ['submitClaimYield', (v: Vault) => v.submitClaimYield(USER, sign)],
  ])('%s resolves a placeholder hash without touching the network', async (_, run) => {
    const vault = await loadVault(null)
    await expect(settle(run(vault))).resolves.toMatch(/^demo/)
    expect(rpcMock.simulateTransaction).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it('submitWithdraw queues amounts above the liquid balance', async () => {
    const vault = await loadVault(null)
    await expect(settle(vault.submitWithdraw(100, USER, sign))).resolves.toMatchObject({
      queued: false,
    })
    await expect(settle(vault.submitWithdraw(500, USER, sign))).resolves.toMatchObject({
      queued: true,
      position: 1,
    })
  })

  it.each([
    ['submitDeposit', (v: Vault, s: AbortSignal) => v.submitDeposit(50, USER, sign, s)],
    ['submitWithdraw', (v: Vault, s: AbortSignal) => v.submitWithdraw(50, USER, sign, s)],
    ['submitClaim', (v: Vault, s: AbortSignal) => v.submitClaim(USER, sign, s)],
  ])('%s rejects when aborted', async (_, run) => {
    const vault = await loadVault(null)
    const controller = new AbortController()
    const pending = run(vault, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('Aborted')

    const preAborted = new AbortController()
    preAborted.abort()
    await expect(run(vault, preAborted.signal)).rejects.toThrow('Aborted')
  })

  it('view reads throw so callers fall back to fixtures', async () => {
    const vault = await loadVault(null)
    await expect(vault.fetchSharePrice(USER)).rejects.toThrow(
      'NEXT_PUBLIC_VAULT_CONTRACT_ID not set',
    )
    await expect(vault.fetchTotalAssets(USER)).rejects.toThrow('not set')
    await expect(vault.fetchPortfolio(USER)).rejects.toThrow('not set')
    await expect(vault.fetchUtilizationBps(USER)).resolves.toBe(0)
  })
})

describe('view calls', () => {
  it('share price reads convert_to_assets(1 share)', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue(
      okSimulation(nativeToScVal(10_250_000n, { type: 'i128' })),
    )
    await expect(vault.fetchSharePrice(USER)).resolves.toBe('1.0250000')
    expect(invocation(simulatedTx())).toMatchObject({
      method: 'convert_to_assets',
      argTypes: ['scvI128'],
      args: [10_000_000n],
    })
    expect(simulatedTx().source).toBe(USER)
  })

  it('share price is 1 for an empty vault', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue(okSimulation(nativeToScVal(0n, { type: 'i128' })))
    await expect(vault.fetchSharePrice(USER)).resolves.toBe('1.0000000')
  })

  it('total_assets() is scaled to USDC', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue(
      okSimulation(nativeToScVal(4_820_000_000_000n, { type: 'i128' })),
    )
    await expect(vault.fetchTotalAssets(USER)).resolves.toBe(482_000)
    expect(invocation(simulatedTx())).toMatchObject({ method: 'total_assets', args: [] })
  })

  it('get_utilization_bps()', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue(
      okSimulation(nativeToScVal(5100, { type: 'u32' })),
    )
    await expect(vault.fetchUtilizationBps(USER)).resolves.toBe(5100)
    expect(invocation(simulatedTx())).toMatchObject({ method: 'get_utilization_bps', args: [] })
  })

  it('get_portfolio(account: Address) maps the PortfolioInfo struct', async () => {
    const vault = await loadVault()
    const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' })
    const info = xdr.ScVal.scvMap(
      [
        ['claimable_yield', i128(12_500_000n)],
        ['share_of_pool_bps', i128(49n)],
        ['shares', i128(1_000_000_000n)],
        ['total_deposited', i128(1_005_000_000n)],
        ['usdc_value', i128(1_010_000_000n)],
      ].map(
        ([key, val]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key as string), val: val as xdr.ScVal }),
      ),
    )
    rpcMock.simulateTransaction.mockResolvedValue(okSimulation(info))

    await expect(vault.fetchPortfolio(USER)).resolves.toEqual({
      shares: 100,
      usdcValue: 101,
      claimableYield: 1.25,
      shareOfPoolBps: 49,
      totalDeposited: 100.5,
    })
    expect(invocation(simulatedTx())).toMatchObject({
      method: 'get_portfolio',
      argTypes: ['scvAddress'],
      args: [USER],
    })
  })

  it('falls back to the cached values when the RPC errors', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue(
      okSimulation(nativeToScVal(20_000_000n, { type: 'i128' })),
    )
    await expect(vault.fetchSharePrice(USER)).resolves.toBe('2.0000000')
    await expect(vault.fetchTotalAssets(USER)).resolves.toBe(2)

    rpcMock.simulateTransaction.mockResolvedValue({ error: 'boom' })
    await expect(vault.fetchSharePrice(USER)).resolves.toBe('2.0000000')
    expect(vault.isOffline()).toBe(true)
    // Once offline, reads short-circuit to the cache without calling the RPC.
    const calls = rpcMock.simulateTransaction.mock.calls.length
    await expect(vault.fetchTotalAssets(USER)).resolves.toBe(2)
    await expect(vault.fetchUtilizationBps(USER)).resolves.toBe(0)
    expect(rpcMock.simulateTransaction).toHaveBeenCalledTimes(calls)
  })

  it('reports a simulation without a result as unavailable', async () => {
    const vault = await loadVault()
    rpcMock.simulateTransaction.mockResolvedValue({ latestLedger: 1 })
    await expect(vault.fetchPortfolio(USER)).rejects.toThrow('Soroban simulate returned no result')
    rpcMock.simulateTransaction.mockResolvedValue({ error: 'nope' })
    await expect(vault.fetchUtilizationBps(USER)).resolves.toBe(0)
  })
})
