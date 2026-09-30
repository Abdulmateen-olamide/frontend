# API Reference — Heliobond Backend Client

This document is the developer reference for [`src/lib/api.ts`](src/lib/api.ts),
the HTTP client that connects the frontend to the Heliobond backend REST API.

Every function falls back to bundled fixture data when `NEXT_PUBLIC_API_URL` is
not set, so the app works out of the box without a running backend.

---

## Table of Contents

1. [Environment configuration](#environment-configuration)
2. [Response types](#response-types)
3. [Endpoints](#endpoints)
   - [getProjects](#getprojects)
   - [getProjectsPaginated](#getprojectspaginated)
   - [getProject](#getproject)
   - [createInvestment](#createinvestment)
   - [getPriceHistory](#getpricehistory)
   - [biometricLogin](#biometriclogin)
4. [Error handling](#error-handling)
5. [Demo / fixture fallback](#demo--fixture-fallback)
6. [Usage examples](#usage-examples)

---

## Environment configuration

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | Backend base URL. When absent, the app runs in demo mode and uses local fixture data. No HTTP requests are made. |
| `NEXT_PUBLIC_DEMO_MODE` | No | `true` | Force demo mode even when `NEXT_PUBLIC_API_URL` is set. Useful for testing or staging previews without a live backend. |

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to point at
your local or staging backend before running `bun run dev`.

---

## Response types

All types are exported from `src/lib/api.ts` and can be imported directly.

### `Project`

Defined in `src/data.ts`. Core bond project record: id, name, yield, term,
rating, funded status, and pool-related fields.

### `ProjectDetail`

Defined in `src/data/projectDetails.ts`. Extended record with oracle score
history, funding timeline, price/yield history, and creator attribution.

### `ProjectWithDetail`

```ts
interface ProjectWithDetail {
  project: Project
  detail: ProjectDetail
}
```

Returned by [`getProject`](#getproject).

### `Investment`

```ts
interface Investment {
  id: number          // Server-assigned investment ID
  projectId: number   // The project invested in
  amount: number      // USDC amount
  projectUrl: string  // Canonical URL, e.g. "/projects/42"
}
```

Returned by [`createInvestment`](#createinvestment).

### `PaginatedProjectsResponse`

```ts
interface PaginatedProjectsResponse {
  projects: Project[]
  total: number     // Total matching records (not just this page)
  page: number      // 1-indexed current page
  pageSize: number  // Items per page
  hasMore: boolean  // Whether another page exists
}
```

Returned by [`getProjectsPaginated`](#getprojectspaginated).

### `PricePoint`

```ts
interface PricePoint {
  date: string   // ISO 8601 date, e.g. "2025-03-14"
  price: number  // Bond price in USDC
  yield?: number // Yield at that date (percentage)
}
```

Returned (as an array) by [`getPriceHistory`](#getpricehistory).

---

## Endpoints

### `getProjects`

```ts
async function getProjects(): Promise<Project[]>
```

Fetches all bond projects.

**Backend endpoint:** `GET /projects`

**Returns:** Array of `Project` objects.

**Throws:** `ApiError` on network failures, HTTP errors, or timeouts (after 8 seconds).

**Demo fallback:** Returns all projects from `src/data.ts` via
`selectProjects()`. **On-chain priority:** If a project registry contract is
configured, data is read from the Stellar blockchain first.

**Example:**

```ts
import { getProjects } from '@/lib/api'

const projects = await getProjects()
// [{ id: 1, name: 'Solaris Alpha', yield: 6.5, ... }, ...]
```

---

### `getProjectsPaginated`

```ts
async function getProjectsPaginated(
  page?: number,     // default: 1
  pageSize?: number, // default: 12
): Promise<PaginatedProjectsResponse>
```

Fetches a paginated slice of bond projects. Use this for the Explore screen
initial load — it reduces time-to-interactive from 3–5 s down to sub-second
by deferring off-screen projects.

**Backend endpoint:** `GET /projects?page={page}&limit={pageSize}`

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | `number` | `1` | 1-indexed page number |
| `pageSize` | `number` | `12` | Items per page |

**Returns:** `PaginatedProjectsResponse`

**Throws:** `ApiError` on network failures, HTTP errors, or timeouts (after 8 seconds).

**Demo fallback:** Slices `selectProjects()` with the same pagination math.
Handles both paginated API responses (`{ projects, total, page, ... }`) and
legacy flat-array responses from older backend versions. **On-chain priority:**
If a project registry contract is configured, data is read from the Stellar
blockchain first.

**Example:**

```ts
import { getProjectsPaginated } from '@/lib/api'

// First page
const page1 = await getProjectsPaginated(1, 12)
// { projects: [...], total: 34, page: 1, pageSize: 12, hasMore: true }

// Next page
const page2 = await getProjectsPaginated(2, 12)
// { projects: [...], total: 34, page: 2, pageSize: 12, hasMore: true }
```

---

### `getProject`

```ts
async function getProject(id: number): Promise<ProjectWithDetail | null>
```

Fetches a single project with its full detail record.

**Backend endpoint:** `GET /projects/:id`

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `id` | `number` | Must be a positive integer (`id >= 1`). Non-integer, negative, zero, or `NaN` ids return `null` immediately without a network call. |

**Returns:** `ProjectWithDetail` or `null` when the project is not found.

**Throws:** `ApiError` on network failures, HTTP errors, or timeouts (after 8 seconds).

**Demo fallback:** Looks up `selectProjectById(id)` and `selectProjectDetail(id)`
from fixture data. Returns `null` if either is missing. **On-chain priority:**
If a project registry contract is configured, project and detail data are read
from the Stellar blockchain first, with a `verifiedMetadata` flag indicating
on-chain verification.

**Example:**

```ts
import { getProject } from '@/lib/api'

const result = await getProject(1)
if (result) {
  const { project, detail } = result
  console.log(project.name, detail.scoreHistory.credit)
}

// Invalid ids return null immediately — no request fired:
await getProject(-1)  // null
await getProject(NaN) // null
await getProject(1.5) // null
```

---

### `createInvestment`

```ts
async function createInvestment(input: {
  projectId: number
  amount: number
}): Promise<Investment>
```

Creates a new investment record on the backend.

**Backend endpoint:** `POST /investments`

**Request body:**

```json
{
  "projectId": 1,
  "amount": 100
}
```

**Parameters:**

| Field | Type | Constraints |
|---|---|---|
| `projectId` | `number` | Must be a positive integer (`>= 1`). Throws on invalid input. |
| `amount` | `number` | Must be a positive finite number (`> 0`). Throws on invalid input. |

**Returns:** `Investment`

**Throws:**
- `Error('Invalid investment input')` for invalid input (non-integer `projectId`,
  `projectId < 1`, non-finite `amount`, or `amount <= 0`)
- `ApiError` on network failures, HTTP errors, or timeouts (after 8 seconds)

Input is validated _before_ any network call, so invalid inputs never reach
the backend.

**Demo fallback:** Returns a mock `Investment` with a random `id`, preserving
`projectId` and `amount`. The `projectUrl` field is always `/projects/:id`.

**Example:**

```ts
import { createInvestment } from '@/lib/api'

// Valid investment
const investment = await createInvestment({ projectId: 3, amount: 250 })
// { id: 84712, projectId: 3, amount: 250, projectUrl: '/projects/3' }

// Invalid — throws before any HTTP call
await createInvestment({ projectId: 0, amount: 100 })  // throws
await createInvestment({ projectId: 1, amount: -50 })  // throws
await createInvestment({ projectId: 1.5, amount: 100 }) // throws
```

---

### `getPriceHistory`

```ts
async function getPriceHistory(projectId: number): Promise<PricePoint[]>
```

Fetches 30-day bond price and yield history for a project.

**Backend endpoint:** `GET /projects/:projectId/price-history`

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `projectId` | `number` | Project ID |

**Returns:** Array of `PricePoint` objects sorted in ascending chronological
order (oldest first). The backend response is re-sorted if necessary.

**Throws:** `ApiError` on network failures, HTTP errors, or timeouts (after 8 seconds).

**Demo fallback:** Generates a deterministic 30-day mock series using
`projectId` as a seed so the sparkline shape is consistent per project across
renders.

**Example:**

```ts
import { getPriceHistory } from '@/lib/api'

const history = await getPriceHistory(2)
// [
//   { date: '2025-08-06', price: 103.42, yield: 5.12 },
//   { date: '2025-08-07', price: 103.61, yield: 5.09 },
//   ...
// ]

// Feed directly into PriceHistoryChart:
<PriceHistoryChart data={history} />
```

---

### `biometricLogin`

```ts
async function biometricLogin(username?: string): Promise<boolean>
```

Triggers a WebAuthn biometric prompt (Face ID / Touch ID) and delegates to the canonical challenge-response flow in `webauthn.ts`.

**Client contract:** Requests options from `/webauthn/login/begin`, presents them to `navigator.credentials.get`, and posts the assertion to `/webauthn/login/complete`. Completion must return HTTP success with `{ "verified": true }`; HTTP success alone is insufficient. Requests use same-origin cookies and disable caching.

**Backend dependency:** This repository does not implement these endpoints. A backend must issue expiring, single-use challenges, verify assertions against stored public keys and the expected origin/RP ID, and establish an authenticated session before returning verification success. The client boolean is UI feedback, not server authorization.

**Returns:** `true` if the biometric assertion was successfully verified by the server, `false` if:
- The username is missing or blank (there is no shared default identity)
- WebAuthn is not supported (`window.PublicKeyCredential` is absent)
- The user cancelled or failed the prompt
- Server challenge issuance or assertion verification failed (logged as a warning)

**Environment:** Only works in a browser context with a registered authenticator. Always returns `false` in SSR (`window === undefined`).

**Example:**

```ts
import { biometricLogin } from '@/lib/api'

const ok = await biometricLogin('user@example.com')
if (ok) {
  // proceed with authenticated session
} else {
  // show fallback (password, wallet sign-in, etc.)
}
```

---

## Error handling

### Data sources and fallback priority

The API client reads project data from three sources in the following priority order:

1. **On-chain registry** — If `isRegistryConfigured()` returns `true` (when a
   Stellar ProjectRegistry contract is deployed and configured), project data
   is read directly from the blockchain via Stellar RPC. This is the highest-
   trust path and bypasses HTTP entirely.
2. **Demo fixtures** — If `NEXT_PUBLIC_API_URL` is **not** set (or
   `NEXT_PUBLIC_DEMO_MODE=true` is explicitly enabled), all functions return
   deterministic mock data from `src/data.ts` and `src/data/projectDetails.ts`.
   No HTTP requests are made. A "Demo data" badge appears in the UI when
   `shouldShowDemoBadge()` returns `true`.
3. **HTTP backend** — If `NEXT_PUBLIC_API_URL` is set and demo mode is off,
   the client calls the configured backend. **Failures throw `ApiError`** —
   they are not silently swallowed.

### ApiError

Network failures, HTTP errors (non-2xx status), and timeouts all throw `ApiError`:

```ts
import { ApiError } from '@/lib/api'

try {
  const projects = await getProjects()
} catch (err) {
  if (err instanceof ApiError) {
    console.error('API failed:', err.status, err.code, err.message)
    // err.status: HTTP status (404, 503, etc.) if applicable
    // err.code: Machine-readable code (e.g., "HTTP_503", "rpc-timeout")
    // err.message: Human-readable message
  }
}
```

`ApiError` is defined in `src/lib/error.ts` and includes optional `status`,
`code`, and `cause` fields for debugging and error reporting.

### Timeout behavior

All HTTP calls are wrapped in an 8-second timeout (`API_TIMEOUT_MS`). If a
request does not complete within 8 seconds, it is aborted and an error is
reported to telemetry with `{ kind: 'rpc-timeout', context: { target: 'api' } }`.
The timeout error is then thrown to the caller.

```ts
// After 8 seconds, throws:
// Error: "timed out after 8000ms"
const projects = await getProjects()
```

### NEXT_PUBLIC_DEMO_MODE

To force demo mode even when `NEXT_PUBLIC_API_URL` is set (useful for testing
or staging previews without a live backend), set:

```bash
NEXT_PUBLIC_DEMO_MODE=true
```

When enabled, `shouldShowDemoBadge()` returns `true` and a visual indicator
appears in the UI so users know the data is not real.

### Usage example with error handling

```ts
import { getProjects, ApiError } from '@/lib/api'

async function loadExploreScreen() {
  try {
    const projects = await getProjects()
    // success — render projects
  } catch (err) {
    if (err instanceof ApiError) {
      // show user-facing error: "Could not load projects. Please try again."
      // log to error reporting: err.status, err.code, err.message
    } else {
      // unexpected error — rethrow or log
      throw err
    }
  }
}
```

For mapping backend error codes to user-facing strings, see
[`src/lib/errorMessages.ts`](src/lib/errorMessages.ts) and
[`ERROR_CODES.md`](ERROR_CODES.md).

---

## Demo / fixture fallback

When `NEXT_PUBLIC_API_URL` is **not set** (or is empty), the app runs in **demo
mode**. In this mode:

- **No HTTP requests are made** — every API function returns deterministic
  fixture data immediately.
- Fixture data comes from:
  - `src/data.ts` — pool summary, projects list, investor position, activity feed
  - `src/data/projectDetails.ts` — per-project oracle history, creator info,
    funding timeline, price history
  - `src/state/selectors.ts` — flat accessor functions over the above
- `shouldShowDemoBadge()` returns `true`, and the UI displays a "Demo data"
  badge so users know the data is not live.

This means the full click-through works without a backend, including the Explore,
Project Detail, and Deposit screens.

### Demo mode vs. HTTP failures

**When `NEXT_PUBLIC_API_URL` is set**, demo mode is **off**. HTTP failures
(timeouts, 5xx errors, network errors) **throw `ApiError`** and do not fall
back to fixtures. The caller must handle the error and show appropriate UI
(loading state, retry button, error message).

To force demo mode even when `NEXT_PUBLIC_API_URL` is set, use:

```bash
NEXT_PUBLIC_DEMO_MODE=true
```

This is useful for testing, staging previews, or demos where you want to use
the production-like URL structure but don't have a live backend.

---

## Usage examples

### Loading the Explore screen lazily

```ts
import { getProjectsPaginated } from '@/lib/api'

// Initial load — first 12 projects only
const { projects, hasMore, total } = await getProjectsPaginated(1, 12)

// Infinite scroll — fetch the next page when the sentinel enters the viewport
if (hasMore) {
  const next = await getProjectsPaginated(2, 12)
}
```

### Project detail page

```ts
// src/app/project/[id]/page.tsx
import { getProject } from '@/lib/api'

export default async function Page({ params }: { params: { id: string } }) {
  const id = Number(params.id)
  const data = await getProject(id)
  if (!data) notFound()
  return <ProjectDetail project={data.project} detail={data.detail} />
}
```

### Creating an investment

```ts
import { createInvestment, ApiError } from '@/lib/api'

async function handleDeposit(projectId: number, amount: number) {
  try {
    const investment = await createInvestment({ projectId, amount })
    router.push(investment.projectUrl)
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid investment input') {
      setFormError('Please enter a valid amount and project ID.')
    } else if (err instanceof ApiError) {
      setFormError('Network error. Please check your connection and try again.')
      console.error('Investment creation failed:', err.status, err.message)
    } else {
      throw err
    }
  }
}
```

### Price history sparkline

```ts
import { getPriceHistory } from '@/lib/api'
import { PriceHistoryChart } from '@/components'

const history = await getPriceHistory(projectId)
return <PriceHistoryChart data={history} />
```
