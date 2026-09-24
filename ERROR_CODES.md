# Error Codes

This document explains the frontend error codes handled by
`src/lib/errorMessages.ts`, plus the API codes the frontend may receive from the
Heliobond backend.

## Frontend Codes

| Code                     | Meaning                                                              | Suggested action                                         |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `insufficient_balance`   | Wallet balance is too low for the requested amount.                  | Use a smaller amount or fund the wallet.                 |
| `insufficient_funds`     | Alias for an insufficient wallet balance.                            | Use a smaller amount or fund the wallet.                 |
| `amount_too_low`         | Deposit or withdrawal amount is below the minimum.                   | Enter at least the displayed minimum amount.             |
| `amount_exceeds_balance` | Requested amount is greater than the available balance.              | Use Max or enter a smaller amount.                       |
| `invalid_amount`         | Amount input could not be parsed as a valid number.                  | Re-enter the amount using numeric characters.            |
| `wallet_not_connected`   | A wallet-only action was attempted without an active wallet session. | Connect a wallet and retry.                              |
| `timeout`                | A network, wallet, or transaction confirmation request timed out.    | Retry after checking network connectivity.               |
| `network_error`          | The frontend could not reach the API, RPC, or wallet provider.       | Check connectivity and retry.                            |
| `simulation_failed`      | Soroban transaction simulation failed before submission.             | Retry; if it repeats, inspect the contract/RPC response. |
| `tx_failed`              | Submitted transaction failed or was rejected.                        | Review wallet details and retry.                         |
| `memo_too_long`          | Stellar text memo exceeds protocol 28-byte limit.                    | Shorten the memo to 28 bytes or fewer.                   |
| `invalid_memo`           | Memo format or length does not match expected memo type.             | Check memo format and length.                            |
| `tx_malformed`           | Transaction format or operation parameters are invalid.              | Verify inputs and retry.                                 |

## API Codes

The backend documents API responses as
`{ "error": { "code": "<code>", "message": "<detail>" } }`. Common codes are:

| Code                   | Meaning                                                | Suggested action                                        |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `bad_request`          | Request parameters or body failed validation.          | Fix the request input shown in the message.             |
| `unauthorized`         | Missing or invalid admin/API bearer token.             | Provide the expected token for protected routes.        |
| `not_found`            | Route or resource was not found.                       | Confirm the route and resource identifier.              |
| `too_many_requests`    | Rate limit exceeded.                                   | Wait for the `Retry-After` window before retrying.      |
| `payload_too_large`    | Request body exceeded the configured size limit.       | Reduce payload size.                                    |
| `server_misconfigured` | Backend is missing required server-side configuration. | Configure the backend environment before retrying.      |
| `INTERNAL_ERROR`       | Unexpected backend exception.                          | Check server logs; do not expose stack traces to users. |

## Opaque `ERR_###` Codes

Codes such as `ERR_008` are not currently defined by the frontend mapper. Treat
them as backend, wallet, protocol, or provider-specific codes until their source
is identified.

When adding a new `ERR_###` code, update this file and add a mapping in
`src/lib/errorMessages.ts` so users see a friendly message instead of the raw
identifier.
