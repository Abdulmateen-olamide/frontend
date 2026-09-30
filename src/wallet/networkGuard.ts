// Wallet ⇄ app network guard (#611).
//
// A transaction built for one network cannot be signed on another: the
// passphrase is part of the signature payload, so a testnet-built transaction
// signed by a wallet set to mainnet (or the reverse) fails with an opaque error.
// The WalletProvider reads the wallet's network after connecting and before
// every signature, and blocks signing with this error when they differ.

import { NETWORK_PASSPHRASE, networkLabel } from '../config/network'

export function networkMismatchMessage(walletPassphrase: string, appPassphrase: string): string {
  const app = networkLabel(appPassphrase)
  return `Your wallet is set to ${networkLabel(walletPassphrase)}, but Heliobond runs on ${app}. Switch your wallet to ${app} and try again.`
}

export class NetworkMismatchError extends Error {
  readonly walletPassphrase: string
  readonly appPassphrase: string

  constructor(walletPassphrase: string, appPassphrase: string = NETWORK_PASSPHRASE) {
    super(networkMismatchMessage(walletPassphrase, appPassphrase))
    this.name = 'NetworkMismatchError'
    this.walletPassphrase = walletPassphrase
    this.appPassphrase = appPassphrase
  }
}

export function isNetworkMismatchError(e: unknown): e is NetworkMismatchError {
  return e instanceof Error && e.name === 'NetworkMismatchError'
}

/**
 * True when the wallet reported a network other than the app's. A wallet that
 * can't report its network (null) is not treated as a mismatch — signing then
 * proceeds and the wallet itself is the last line of defence.
 */
export function isNetworkMismatch(
  walletPassphrase: string | null,
  appPassphrase: string = NETWORK_PASSPHRASE,
): boolean {
  return walletPassphrase !== null && walletPassphrase !== appPassphrase
}
