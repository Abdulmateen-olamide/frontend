// Keypair-backed stellar-wallets-kit module for end-to-end tests (#607).
//
// Playwright can't drive a browser-extension wallet, so e2e builds
// (NEXT_PUBLIC_E2E_TEST_WALLET=true, never on mainnet — see WalletProvider)
// register this module. The test injects a throwaway secret key with
// page.addInitScript before the app loads:
//
//   window.__HB_E2E_WALLET__ = { secret: 'S…', networkPassphrase?: '…' }
//
// `networkPassphrase` defaults to the app's own passphrase; a spec can set a
// different one to exercise the wallet/app network-mismatch guard (#611).

import { ModuleType, type ModuleInterface } from '@creit.tech/stellar-wallets-kit/types'
import { NETWORK_PASSPHRASE, networkLabel } from '../config/network'

export const E2E_TEST_WALLET_ID = 'e2e-test-wallet'

export interface E2EWalletConfig {
  secret: string
  networkPassphrase?: string
}

declare global {
  interface Window {
    __HB_E2E_WALLET__?: E2EWalletConfig
  }
}

function config(): E2EWalletConfig {
  const cfg = typeof window === 'undefined' ? undefined : window.__HB_E2E_WALLET__
  if (!cfg?.secret) throw new Error('E2E test wallet: window.__HB_E2E_WALLET__.secret is not set')
  return cfg
}

async function keypair() {
  const { Keypair } = await import('@stellar/stellar-sdk')
  return Keypair.fromSecret(config().secret)
}

export class E2ETestWalletModule implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET
  productId = E2E_TEST_WALLET_ID
  productName = 'E2E Test Wallet'
  productUrl = 'https://github.com/Heliobond/frontend'
  productIcon =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23ffb400"/></svg>'

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && Boolean(window.__HB_E2E_WALLET__?.secret)
  }

  async getAddress(): Promise<{ address: string }> {
    return { address: (await keypair()).publicKey() }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    const networkPassphrase = config().networkPassphrase ?? NETWORK_PASSPHRASE
    return { network: networkLabel(networkPassphrase), networkPassphrase }
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk')
    const kp = await keypair()
    const tx = TransactionBuilder.fromXDR(xdr, opts?.networkPassphrase ?? NETWORK_PASSPHRASE)
    tx.sign(kp)
    return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() }
  }

  // The investor journey only needs source-account auth, which the transaction
  // signature covers.
  async signAuthEntry(): Promise<{ signedAuthEntry: string }> {
    throw new Error('E2E test wallet: signAuthEntry is not supported')
  }

  async signMessage(): Promise<{ signedMessage: string }> {
    throw new Error('E2E test wallet: signMessage is not supported')
  }
}
