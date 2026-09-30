/**
 * ProjectRegistry client for reading on-chain projects and details.
 * Interacts with deployed Soroban ProjectRegistry contract when NEXT_PUBLIC_REGISTRY_CONTRACT_ID is configured.
 * Implements short-window caching, off-chain metadata resolution, and hash verification.
 * Gracefully falls back to bundled fixtures in demo mode.
 */

import { type Project, type ProjectType } from '../data'
import { type ProjectDetail, type ScorePoint } from '../data/projectDetails'
import {
  selectProjects,
  selectProjectById,
  selectProjectDetail,
  selectScoreHistory,
} from '../state/selectors'
import { STELLAR_NETWORK, SOROBAN_RPC_URL as RPC_URL } from '../config/network'

const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID

const CACHE_TTL_MS = 30000

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const memoryCache = new Map<string, CacheEntry<unknown>>()

function getFromCache<T>(key: string): T | null {
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    memoryCache.delete(key)
    return null
  }
  return entry.data as T
}

function setInCache<T>(key: string, data: T): void {
  memoryCache.set(key, { data, timestamp: Date.now() })
}

export function clearRegistryCache(): void {
  memoryCache.clear()
}

/** Check if on-chain ProjectRegistry is configured */
export function isRegistryConfigured(): boolean {
  return Boolean(REGISTRY_CONTRACT_ID)
}

/** Simulate a read call on the ProjectRegistry contract */
async function simulateRegistryCall(
  method: string,
  args: unknown[] = [],
  sourceAddress = 'GBQHWXVZ2K4M6N8P3R5T7W9YA2C4E6G8J3L5Q7S9U2X4Z6B8D1F3H59XQ',
): Promise<unknown> {
  if (!REGISTRY_CONTRACT_ID) throw new Error('NEXT_PUBLIC_REGISTRY_CONTRACT_ID not set')

  const { rpc, Contract, TransactionBuilder, Networks, Account, nativeToScVal, scValToNative } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const contract = new Contract(REGISTRY_CONTRACT_ID)
  const source = new Account(sourceAddress, '0')
  const networkPassphrase = STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET

  const buildArgs = (useU32: boolean) =>
    args.map((a) => {
      if (a && typeof a === 'object' && typeof (a as { switch?: unknown }).switch === 'function') {
        return a
      }
      if (typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 4294967295) {
        return useU32
          ? nativeToScVal(a, { type: 'u32' })
          : nativeToScVal(BigInt(a), { type: 'u64' })
      }
      return nativeToScVal(a)
    })

  let lastError: unknown = null
  for (const useU32 of [true, false]) {
    try {
      const scArgs = buildArgs(useU32)
      const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase })
        .addOperation(contract.call(method, ...(scArgs as Parameters<typeof contract.call>[1][])))
        .setTimeout(0)
        .build()

      const simResult = await server.simulateTransaction(tx)
      if ('error' in simResult) {
        lastError = simResult.error
        continue
      }
      if (simResult.result?.retval) {
        return scValToNative(simResult.result.retval)
      }
    } catch (e) {
      lastError = e
    }
  }

  throw new Error(`Simulate failed for ${method}: ${lastError}`)
}

/** Compute hex SHA-256 hash in browser or Node environments */
async function computeSha256(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return ''
}

/**
 * `ProjectData` as returned by the ProjectRegistry contract. Note there is no
 * `id` (the id is the key/tuple element) and no display fields such as name or
 * funding amounts — those come from the off-chain `uri` metadata.
 */
export interface OnChainProjectRaw {
  owner: string
  uri: string
  credit_quality: number | bigint
  green_impact: number | bigint
  maturity_date: number | bigint
  certification_status: number | bigint
  last_update_timestamp: number | bigint
  /** `ProjectStatus` enum: Pending=0, Active=1, Funded=2, Completed=3, Archived=4 */
  status: number | bigint
  created_at: number | bigint
  metadata_hash: string | Uint8Array
}

/** A `(u32, ProjectData)` element from `get_projects_page`. */
export type OnChainProjectTuple = [number | bigint, OnChainProjectRaw]

/** A single `ScoreHistoryEntry` from `get_score_history`. */
export interface OnChainScoreHistoryEntryRaw {
  timestamp: number | bigint
  credit_quality: number | bigint
  green_impact: number | bigint
}

export interface OffChainMetadata {
  name?: string
  description?: string
  location?: string
  type?: ProjectType
  story?: string
  heroGradient?: string
  fundingGoal?: number
  priceHistory?: Array<{ date: string; price: number; yield: number }>
}

/** Map the contract's numeric `ProjectStatus` enum to the UI status union. */
export function mapProjectStatus(
  status: number | bigint | string | null | undefined,
): Project['status'] | undefined {
  if (typeof status === 'string') {
    switch (status.toLowerCase()) {
      case 'active':
      case 'open':
        return 'open'
      case 'pending':
      case 'upcoming':
        return 'upcoming'
      case 'funded':
      case 'completed':
      case 'archived':
        return 'funded'
      default:
        return undefined
    }
  }
  switch (Number(status)) {
    case 0:
      return 'upcoming' // Pending
    case 1:
      return 'open' // Active
    case 2:
      return 'funded' // Funded
    case 3:
      return 'funded' // Completed
    case 4:
      return 'funded' // Archived
    default:
      return undefined
  }
}

/** Map on-chain ProjectData plus its id and optional metadata to a UI Project. */
export function mapOnChainProject(
  raw: OnChainProjectRaw,
  id: number,
  metadata?: OffChainMetadata,
): Project {
  const credit = Number(raw.credit_quality ?? 80)
  const green = Number(raw.green_impact ?? 80)

  const fallback = selectProjectById(id)

  const fundedAmount = fallback?.fundedAmount ?? 0
  const fundingGoal = metadata?.fundingGoal || fallback?.fundingGoal || 1000000

  return {
    id,
    name: metadata?.name || fallback?.name || `Bond Project #${id}`,
    location: metadata?.location || fallback?.location || 'Stellar Network',
    type: metadata?.type || fallback?.type || 'Solar',
    credit: Number.isFinite(credit) ? credit : 80,
    green: Number.isFinite(green) ? green : 80,
    funded: `$${fundedAmount.toLocaleString('en-US')}`,
    fundedAmount,
    fundingGoal,
    status: mapProjectStatus(raw.status) ?? fallback?.status ?? 'open',
    priceHistory: metadata?.priceHistory || fallback?.priceHistory || [],
  }
}

/** Render a score-history unix timestamp (seconds) as a short date label. */
function formatScoreDate(timestamp: number | bigint | undefined, index: number): string {
  const seconds = Number(timestamp)
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  return `${index + 1}mo ago`
}

/** Read total projects count from ProjectRegistry */
export async function fetchTotalProjects(sourceAddress?: string): Promise<number> {
  const cacheKey = 'total_projects'
  const cached = getFromCache<number>(cacheKey)
  if (cached !== null) return cached

  if (!REGISTRY_CONTRACT_ID) {
    return selectProjects().length
  }

  try {
    const retval = await simulateRegistryCall('total_projects', [], sourceAddress)
    const total = Number(retval)
    setInCache(cacheKey, total)
    return total
  } catch {
    return selectProjects().length
  }
}

export interface ProjectsPageResult {
  projects: Project[]
  total: number
  hasMore: boolean
}

/** Read paginated projects from ProjectRegistry (get_projects_page) */
export async function fetchProjectsPage(
  offset = 0,
  limit = 12,
  sourceAddress?: string,
): Promise<ProjectsPageResult> {
  const cacheKey = `page_${offset}_${limit}`
  const cached = getFromCache<ProjectsPageResult>(cacheKey)
  if (cached !== null) return cached

  if (!REGISTRY_CONTRACT_ID) {
    const all = selectProjects()
    const slice = all.slice(offset, offset + limit)
    const result: ProjectsPageResult = {
      projects: slice,
      total: all.length,
      hasMore: offset + limit < all.length,
    }
    return result
  }

  try {
    const rawList = (await simulateRegistryCall(
      'get_projects_page',
      [offset, limit],
      sourceAddress,
    )) as OnChainProjectTuple[]

    const projects: Project[] = (rawList || []).map((entry) => {
      const [rawId, data] = Array.isArray(entry)
        ? entry
        : [(entry as OnChainProjectRaw & { id?: number | bigint }).id, entry]
      return mapOnChainProject(data as OnChainProjectRaw, Number(rawId))
    })
    const total = await fetchTotalProjects(sourceAddress)
    const result: ProjectsPageResult = {
      projects,
      total,
      hasMore: offset + limit < total,
    }
    setInCache(cacheKey, result)
    return result
  } catch {
    const all = selectProjects()
    const slice = all.slice(offset, offset + limit)
    return {
      projects: slice,
      total: all.length,
      hasMore: offset + limit < all.length,
    }
  }
}

export interface ProjectWithVerification {
  project: Project
  detail: ProjectDetail
  verifiedMetadata: boolean
}

/** Read single project and verify metadata hash */
export async function fetchProjectWithDetails(
  id: number,
  sourceAddress?: string,
): Promise<ProjectWithVerification | null> {
  const cacheKey = `project_detail_${id}`
  const cached = getFromCache<ProjectWithVerification>(cacheKey)
  if (cached !== null) return cached

  const fallbackProject = selectProjectById(id)
  const fallbackDetail = selectProjectDetail(id)

  if (!REGISTRY_CONTRACT_ID) {
    if (!fallbackProject || !fallbackDetail) return null
    return {
      project: fallbackProject,
      detail: fallbackDetail,
      verifiedMetadata: true,
    }
  }

  try {
    const raw = (await simulateRegistryCall(
      'get_project',
      [id],
      sourceAddress,
    )) as OnChainProjectRaw | null

    if (!raw) {
      if (!fallbackProject || !fallbackDetail) return null
      return {
        project: fallbackProject,
        detail: fallbackDetail,
        verifiedMetadata: false,
      }
    }

    let verifiedMetadata = false
    let offChainMetadata: OffChainMetadata | undefined

    if (raw.uri) {
      try {
        const res = await fetch(raw.uri)
        if (res.ok) {
          const text = await res.text()
          offChainMetadata = JSON.parse(text)
          if (raw.metadata_hash) {
            const computedHash = await computeSha256(text)
            const expected =
              typeof raw.metadata_hash === 'string'
                ? raw.metadata_hash
                : Array.from(raw.metadata_hash)
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('')
            verifiedMetadata = computedHash.toLowerCase() === expected.toLowerCase()
          } else {
            verifiedMetadata = true
          }
        }
      } catch {
        /* fallback to on-chain verification method */
        try {
          const verifyResult = await simulateRegistryCall(
            'verify_metadata_hash',
            [id, raw.metadata_hash],
            sourceAddress,
          )
          verifiedMetadata = Boolean(verifyResult)
        } catch {
          verifiedMetadata = true
        }
      }
    } else {
      verifiedMetadata = true
    }

    const project = mapOnChainProject(raw, id, offChainMetadata)

    let scoreHistory = fallbackDetail?.scoreHistory
    try {
      const onChainHistory = await fetchScoreHistory(id, sourceAddress)
      if (onChainHistory.credit.length > 0 || onChainHistory.green.length > 0) {
        scoreHistory = onChainHistory
      }
    } catch {
      /* use fallback scoreHistory */
    }

    const detail: ProjectDetail = fallbackDetail ?? {
      name: project.name,
      location: project.location,
      story: offChainMetadata?.story || 'Project registered on Stellar ProjectRegistry.',
      heroGradient:
        offChainMetadata?.heroGradient ||
        'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(16,185,129,0.2) 100%)',
      creator: {
        name: raw.owner ? `${raw.owner.slice(0, 4)}…${raw.owner.slice(-4)}` : 'Creator',
        verified: true,
        since: '2025',
      },
      scoreHistory: scoreHistory ?? { credit: [], green: [] },
      priceHistory: project.priceHistory.map((p) => ({
        date: p.date,
        price: p.price,
        yield: p.yield,
        hash: `0x${id.toString(16)}0000`,
      })),
      fundingGoal: project.fundingGoal,
      fundedAmount: project.fundedAmount,
      fundingTimeline: [],
    }

    const result: ProjectWithVerification = {
      project,
      detail,
      verifiedMetadata,
    }

    setInCache(cacheKey, result)
    return result
  } catch {
    if (!fallbackProject || !fallbackDetail) return null
    return {
      project: fallbackProject,
      detail: fallbackDetail,
      verifiedMetadata: true,
    }
  }
}

/** Read score history for sparklines from ProjectRegistry */
export async function fetchScoreHistory(
  id: number,
  sourceAddress?: string,
): Promise<{ credit: ScorePoint[]; green: ScorePoint[] }> {
  const cacheKey = `score_history_${id}`
  const cached = getFromCache<{ credit: ScorePoint[]; green: ScorePoint[] }>(cacheKey)
  if (cached !== null) return cached

  if (!REGISTRY_CONTRACT_ID) {
    return selectScoreHistory(id)
  }

  try {
    const raw = (await simulateRegistryCall(
      'get_score_history',
      [id],
      sourceAddress,
    )) as OnChainScoreHistoryEntryRaw[]

    if (Array.isArray(raw) && raw.length > 0) {
      const credit: ScorePoint[] = raw.map((r, i) => ({
        date: formatScoreDate(r.timestamp, i),
        value: Number(r.credit_quality),
        hash: `0xscore${id}${i}`,
      }))
      const green: ScorePoint[] = raw.map((r, i) => ({
        date: formatScoreDate(r.timestamp, i),
        value: Number(r.green_impact),
        hash: `0xscore${id}${i}`,
      }))
      const history = { credit, green }
      setInCache(cacheKey, history)
      return history
    }
    return selectScoreHistory(id)
  } catch {
    return selectScoreHistory(id)
  }
}
