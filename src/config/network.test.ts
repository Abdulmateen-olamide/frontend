import { describe, it, expect } from 'vitest'
import {
  validateNetwork,
  getExplorerTxUrl,
  getExplorerAccountUrl,
  getExplorerUrl,
  STELLAR_NETWORK,
  HORIZON_URL,
  SOROBAN_RPC_URL,
} from './network'

describe('network configuration', () => {
  it('defaults to testnet when undefined or empty', () => {
    expect(validateNetwork(undefined)).toBe('testnet')
    expect(validateNetwork('')).toBe('testnet')
  })

  it('accepts valid network names case-insensitively', () => {
    expect(validateNetwork('testnet')).toBe('testnet')
    expect(validateNetwork('TESTNET')).toBe('testnet')
    expect(validateNetwork('public')).toBe('public')
    expect(validateNetwork('PUBLIC')).toBe('public')
  })

  it('throws a descriptive error on unknown network value', () => {
    expect(() => validateNetwork('mainnet')).toThrow(
      'Unknown Stellar network: "mainnet". Expected "testnet" or "public".',
    )
    expect(() => validateNetwork('localnet')).toThrow(
      'Unknown Stellar network: "localnet". Expected "testnet" or "public".',
    )
  })

  it('provides active network and non-empty URLs', () => {
    expect(['testnet', 'public']).toContain(STELLAR_NETWORK)
    expect(HORIZON_URL).toContain('stellar.org')
    expect(SOROBAN_RPC_URL).toContain('stellar.org')
  })

  it('generates correct explorer URLs', () => {
    const tx = 'a'.repeat(64)
    const addr = 'G' + 'A'.repeat(55)
    expect(getExplorerTxUrl(tx)).toContain(`/tx/${tx}`)
    expect(getExplorerAccountUrl(addr)).toContain(`/account/${addr}`)
    expect(getExplorerUrl(tx)).toContain(`/tx/${tx}`)
    expect(getExplorerUrl(addr)).toContain(`/account/${addr}`)
    expect(getExplorerUrl('short-val')).toBeUndefined()
  })
})
