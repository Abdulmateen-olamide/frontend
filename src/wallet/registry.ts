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

function getRegistryContractId(): string | undefined {
  return process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID
}

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
  return Boolean(getRegistryContractId())
}

/** Simulate a read call on the ProjectRegistry contract */
export async function defaultSimulateRegistryCall(
  method: string,
  args: unknown[] = [],
  sourceAddress = 'GBQHWXVZ2K4M6N8P3R5T7W9YA2C4E6G8J3L5Q7S9U2X4Z6B8D1F3H59XQ',
): Promise<unknown> {
  const contractId = getRegistryContractId()
  if (!contractId) throw new Error('NEXT_PUBLIC_REGISTRY_CONTRACT_ID not set')

  const { rpc, Contract, TransactionBuilder, Networks, Account, nativeToScVal, scValToNative } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const contract = new Contract(contractId)
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

export type RegistrySimulator = (
  method: string,
  args?: unknown[],
  sourceAddress?: string,
) => Promise<unknown>

let activeSimulateRegistryCall: RegistrySimulator = defaultSimulateRegistryCall

export function setSimulateRegistryCall(fn: RegistrySimulator): void {
  activeSimulateRegistryCall = fn
}

export function resetSimulateRegistryCall(): void {
  activeSimulateRegistryCall = defaultSimulateRegistryCall
}

export async function simulateRegistryCall(
  method: string,
  args: unknown[] = [],
  sourceAddress?: string,
): Promise<unknown> {
  return activeSimulateRegistryCall(method, args, sourceAddress)
}

/** Compute hex SHA-256 hash in browser or Node environments.
 * Returns null if crypto.subtle is unavailable (e.g. non-secure context).
 */
export async function computeSha256(content: ArrayBuffer | Uint8Array): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) {
    return null
  }
  const data = content instanceof Uint8Array ? content : new Uint8Array(content)
  const hashBuffer = await subtle.digest('SHA-256', data as BufferSource)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase()
}

/**
 * Normalizes an on-chain metadata hash into a 64-character lowercase hex string.
 * Returns null if missing, empty, or not a valid 32-byte representation.
 */
export function normalizeHash(
  rawHash: string | Uint8Array | number[] | undefined | null,
): string | null {
  if (!rawHash) return null
  if (typeof rawHash === 'string') {
    const trimmed = rawHash.trim()
    const clean = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
    if (/^[0-9a-fA-F]{64}$/.test(clean)) {
      return clean.toLowerCase()
    }
    return null
  }
  if (rawHash instanceof Uint8Array || Array.isArray(rawHash)) {
    const arr = Array.from(rawHash)
    if (arr.length === 32) {
      return arr
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toLowerCase()
    }
    return null
  }
  return null
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

  if (!getRegistryContractId()) {
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

  if (!getRegistryContractId()) {
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

export type MetadataVerificationStatus = 'verified' | 'mismatch' | 'unverified'

export interface ProjectWithVerification {
  project: Project
  detail: ProjectDetail
  verifiedMetadata: MetadataVerificationStatus
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

  if (!getRegistryContractId()) {
    if (!fallbackProject || !fallbackDetail) return null
    return {
      project: fallbackProject,
      detail: fallbackDetail,
      verifiedMetadata: 'unverified',
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
        verifiedMetadata: 'unverified',
      }
    }

    let verifiedMetadata: MetadataVerificationStatus = 'unverified'
    let offChainMetadata: OffChainMetadata | undefined

    if (raw.metadata_uri) {
      try {
        const res = await fetch(raw.metadata_uri)
        if (res.ok) {
          const rawBytes = await res.arrayBuffer()
          const expected = normalizeHash(raw.metadata_hash)

          if (expected) {
            const computedHash = await computeSha256(rawBytes)
            if (computedHash === null) {
              // crypto.subtle is unavailable (non-secure context) -> unverified
              verifiedMetadata = 'unverified'
            } else if (computedHash.toLowerCase() !== expected.toLowerCase()) {
              // Computed hash differs from on-chain hash -> mismatch
              verifiedMetadata = 'mismatch'
            } else {
              // Hash matched on-chain hash! Parse JSON payload.
              try {
                const text = new TextDecoder().decode(rawBytes)
                offChainMetadata = JSON.parse(text)
                verifiedMetadata = 'verified'
              } catch {
                // Parse failure on correctly hashed content fails closed to unverified
                verifiedMetadata = 'unverified'
              }
            }
          } else {
            // Missing or malformed on-chain metadata_hash -> unverified
            verifiedMetadata = 'unverified'
            try {
              const text = new TextDecoder().decode(rawBytes)
              offChainMetadata = JSON.parse(text)
            } catch {
              // Ignore parse error when hash is missing
            }
          }
        } else {
          // HTTP error response from metadata host -> unverified
          verifiedMetadata = 'unverified'
        }
      } catch {
        // Network or fetch failure -> unverified
        verifiedMetadata = 'unverified'
      }
    } else {
      // Missing metadata_uri -> unverified
      verifiedMetadata = 'unverified'
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
  } catch {
    if (!fallbackProject || !fallbackDetail) return null
    return {
      project: fallbackProject,
      detail: fallbackDetail,
      verifiedMetadata: 'unverified',
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

  if (!getRegistryContractId()) {
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
  } catch {
    return selectScoreHistory(id)
  }
}
