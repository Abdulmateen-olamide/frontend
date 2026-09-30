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
import {
  SOROBAN_RPC_URL as RPC_URL,
  NETWORK_PASSPHRASE,
  allowHttpFor,
} from '../config/network'
import { reportError } from '../lib/errorReporting'

const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID

const CACHE_TTL_MS = 30000

/**
 * Well-formed Ed25519 public key used as the source account for read-only
 * registry simulations. Simulations are never submitted, so the account only
 * has to be a valid G-address — it never needs to exist on-chain. Mirrors
 * `DEMO_ADDRESS` in WalletProvider.tsx (#625).
 */
export const SIMULATION_SOURCE_ADDRESS =
  'GCOQ4JRRUC7SBUXLKYXFCZPJWTKDFTULI6DOGB75DZNAVGIST3BNC6UX'

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
  sourceAddress = SIMULATION_SOURCE_ADDRESS,
): Promise<unknown> {
  if (!REGISTRY_CONTRACT_ID) throw new Error('NEXT_PUBLIC_REGISTRY_CONTRACT_ID not set')

  const { rpc, Contract, TransactionBuilder, Account, nativeToScVal, scValToNative } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: allowHttpFor(RPC_URL) })
  const contract = new Contract(REGISTRY_CONTRACT_ID)
  const source = new Account(sourceAddress, '0')
  // Honour NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE (local quickstart) via config.
  const networkPassphrase = NETWORK_PASSPHRASE

  // Registry IDs, offsets and limits are all u32 in the contract ABI (#625).
  const scArgs = args.map((a) => {
    if (a && typeof a === 'object' && typeof (a as { switch?: unknown }).switch === 'function') {
      return a
    }
    if (typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 4294967295) {
      return nativeToScVal(a, { type: 'u32' })
    }
    return nativeToScVal(a)
  })

  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase })
    .addOperation(contract.call(method, ...(scArgs as Parameters<typeof contract.call>[1][])))
    .setTimeout(0)
    .build()

  const simResult = await server.simulateTransaction(tx)
  if ('error' in simResult) {
    throw new Error(`Simulate failed for ${method}: ${simResult.error}`)
  }
  if (!simResult.result?.retval) {
    throw new Error(`Simulate failed for ${method}: empty simulation result`)
  }
  return scValToNative(simResult.result.retval)
}

/**
 * True for caller/programming mistakes (invalid source address, undecodable
 * args) that must surface instead of being hidden behind demo fixtures (#625).
 */
function isProgrammingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('accountId is invalid') ||
    msg.includes('Invalid address') ||
    msg.includes('invalid address') ||
    msg.includes('Malformed') ||
    msg.includes('malformed') ||
    msg.includes('not a valid')
  )
}

/** Report a failed on-chain registry read before any fixture fallback (#625). */
function reportRegistryReadError(method: string, error: unknown): void {
  reportError(error, { kind: 'transaction', context: { target: 'registry', method } })
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

export interface OnChainProjectRaw {
  id: number | bigint
  name?: string
  creator?: string
  metadata_uri?: string
  metadata_hash?: string | Uint8Array
  credit_score?: number | bigint
  green_score?: number | bigint
  status?: string
  funded_amount?: number | bigint
  target_amount?: number | bigint
}

export interface OffChainMetadata {
  description?: string
  location?: string
  type?: ProjectType
  story?: string
  heroGradient?: string
  fundingGoal?: number
  priceHistory?: Array<{ date: string; price: number; yield: number }>
}

/** Map on-chain project struct and optional metadata to UI Project */
export function mapOnChainProject(raw: OnChainProjectRaw, metadata?: OffChainMetadata): Project {
  const id = Number(raw.id)
  const credit = Number(raw.credit_score ?? 80)
  const green = Number(raw.green_score ?? 80)
  const rawFunded = Number(raw.funded_amount ?? 0)
  const fundedAmount = rawFunded > 1e7 ? Math.round(rawFunded / 1e7) : rawFunded
  const rawTarget = Number(raw.target_amount ?? 1000000)
  const fundingGoal = rawTarget > 1e7 ? Math.round(rawTarget / 1e7) : rawTarget

  const fallback = selectProjectById(id)

  return {
    id,
    name: raw.name || fallback?.name || `Bond Project #${id}`,
    location: metadata?.location || fallback?.location || 'Stellar Network',
    type: metadata?.type || fallback?.type || 'Solar',
    credit,
    green,
    funded: `$${fundedAmount.toLocaleString('en-US')}`,
    fundedAmount,
    fundingGoal: metadata?.fundingGoal || fundingGoal || fallback?.fundingGoal || 1000000,
    status: (raw.status as Project['status']) || fallback?.status || 'open',
    priceHistory: metadata?.priceHistory || fallback?.priceHistory || [],
  }
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
  } catch (error) {
    reportRegistryReadError('total_projects', error)
    if (isProgrammingError(error)) throw error
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
    )) as OnChainProjectRaw[]

    const projects: Project[] = (rawList || []).map((raw) => mapOnChainProject(raw))
    const total = await fetchTotalProjects(sourceAddress)
    const result: ProjectsPageResult = {
      projects,
      total,
      hasMore: offset + limit < total,
    }
    setInCache(cacheKey, result)
    return result
  } catch (error) {
    reportRegistryReadError('get_projects_page', error)
    if (isProgrammingError(error)) throw error
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

    if (raw.metadata_uri) {
      try {
        const res = await fetch(raw.metadata_uri)
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

    const project = mapOnChainProject(raw, offChainMetadata)

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
        name: raw.creator ? `${raw.creator.slice(0, 4)}…${raw.creator.slice(-4)}` : 'Creator',
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
  } catch (error) {
    reportRegistryReadError('get_project', error)
    if (isProgrammingError(error)) throw error
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
    const raw = (await simulateRegistryCall('get_score_history', [id], sourceAddress)) as Array<{
      date?: string
      timestamp?: number
      credit: number
      green: number
      hash?: string
    }>

    if (Array.isArray(raw) && raw.length > 0) {
      const credit: ScorePoint[] = raw.map((r, i) => ({
        date: r.date || `${i + 1}mo ago`,
        value: Number(r.credit),
        hash: r.hash || `0xscore${id}${i}`,
      }))
      const green: ScorePoint[] = raw.map((r, i) => ({
        date: r.date || `${i + 1}mo ago`,
        value: Number(r.green),
        hash: r.hash || `0xscore${id}${i}`,
      }))
      const history = { credit, green }
      setInCache(cacheKey, history)
      return history
    }
    return selectScoreHistory(id)
  } catch (error) {
    reportRegistryReadError('get_score_history', error)
    if (isProgrammingError(error)) throw error
    return selectScoreHistory(id)
  }
}
