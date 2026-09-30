import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mapOnChainProject,
  fetchTotalProjects,
  fetchProjectsPage,
  fetchProjectWithDetails,
  fetchScoreHistory,
  clearRegistryCache,
  isRegistryConfigured,
  computeSha256,
  normalizeHash,
  setSimulateRegistryCall,
  resetSimulateRegistryCall,
  type OnChainProjectRaw,
} from './registry'

describe('registry client', () => {
  beforeEach(() => {
    clearRegistryCache()
    resetSimulateRegistryCall()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    clearRegistryCache()
    resetSimulateRegistryCall()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('maps on-chain project data to UI Project format', () => {
    const raw = {
      id: 101,
      name: 'Sahara Agrivoltaic Test',
      credit_score: 92,
      green_score: 95,
      funded_amount: 5000000000000n, // 500,000 * 10^7
      target_amount: 10000000000000n,
      status: 'open',
    }

    const metadata = {
      location: 'Ouarzazate, Morocco',
      type: 'Solar' as const,
      fundingGoal: 1000000,
    }

    const mapped = mapOnChainProject(raw, metadata)
    expect(mapped.id).toBe(101)
    expect(mapped.name).toBe('Sahara Agrivoltaic Test')
    expect(mapped.credit).toBe(92)
    expect(mapped.green).toBe(95)
    expect(mapped.fundedAmount).toBe(500000)
    expect(mapped.location).toBe('Ouarzazate, Morocco')
    expect(mapped.type).toBe('Solar')
  })

  it('falls back gracefully to fixtures when registry contract is unset', async () => {
    expect(isRegistryConfigured()).toBe(false)

    const total = await fetchTotalProjects()
    expect(total).toBeGreaterThan(0)

    const page = await fetchProjectsPage(0, 3)
    expect(page.projects).toHaveLength(3)
    expect(page.total).toBe(total)

    const detail = await fetchProjectWithDetails(1)
    expect(detail).not.toBeNull()
    expect(detail?.project.id).toBe(1)
    expect(detail?.verifiedMetadata).toBe('unverified')

    const scores = await fetchScoreHistory(1)
    expect(scores.credit.length).toBeGreaterThan(0)
    expect(scores.green.length).toBeGreaterThan(0)
  })

  describe('computeSha256 and normalizeHash helpers', () => {
    it('computes expected lowercase SHA-256 hex string from ArrayBuffer or Uint8Array', async () => {
      const raw = new TextEncoder().encode('heliobond metadata test string')
      const hashFromArrayBuffer = await computeSha256(raw.buffer)
      const hashFromUint8 = await computeSha256(raw)
      expect(hashFromArrayBuffer).toBe(hashFromUint8)
      expect(hashFromArrayBuffer).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns null if crypto.subtle is unavailable', async () => {
      const raw = new TextEncoder().encode('test')
      const subtleSpy = vi
        .spyOn(globalThis.crypto, 'subtle', 'get')
        .mockReturnValue(undefined as unknown as SubtleCrypto)
      try {
        const res = await computeSha256(raw)
        expect(res).toBeNull()
      } finally {
        subtleSpy.mockRestore()
      }
    })

    it('normalizes valid 64-char hex strings and 32-byte arrays', () => {
      const hex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      expect(normalizeHash(hex)).toBe(hex)
      expect(normalizeHash(`0x${hex.toUpperCase()}`)).toBe(hex)

      const bytes = new Uint8Array(32).fill(0xab)
      expect(normalizeHash(bytes)).toBe('ab'.repeat(32))
      expect(normalizeHash(Array.from(bytes))).toBe('ab'.repeat(32))

      expect(normalizeHash('')).toBeNull()
      expect(normalizeHash(undefined)).toBeNull()
      expect(normalizeHash(null)).toBeNull()
      expect(normalizeHash('invalid-hex')).toBeNull()
      expect(normalizeHash('1234')).toBeNull()
      expect(normalizeHash(new Uint8Array(16))).toBeNull()
    })
  })

  describe('fail-closed metadata verification (fetchProjectWithDetails)', () => {
    const TEST_CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

    const validMetadata = {
      location: 'Ouarzazate, Morocco',
      type: 'Solar' as const,
      story: 'Verified solar farm project.',
    }
    const validBytes = new TextEncoder().encode(JSON.stringify(validMetadata))

    const baseRawProject: OnChainProjectRaw = {
      id: 1,
      name: 'On-Chain Solar Project',
      creator: 'GBQHWXVZ2K4M6N8P3R5T7W9YA2C4E6G8J3L5Q7S9U2X4Z6B8D1F3H59XQ',
      metadata_uri: 'https://metadata.example.com/project-1.json',
      metadata_hash: '',
      credit_score: 92,
      green_score: 95,
      status: 'open',
      funded_amount: 100000000000n,
      target_amount: 500000000000n,
    }

    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_REGISTRY_CONTRACT_ID', TEST_CONTRACT_ID)
      expect(isRegistryConfigured()).toBe(true)
    })

    it('returns "verified" when SHA-256 of fetched raw bytes matches on-chain hash', async () => {
      const matchingHash = (await computeSha256(validBytes))!
      expect(matchingHash).toBeDefined()

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: matchingHash }
        }
        if (method === 'get_score_history') {
          return []
        }
        return null
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => validBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('verified')
      expect(res?.project.location).toBe('Ouarzazate, Morocco')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "verified" when on-chain hash is a 32-byte Uint8Array that matches', async () => {
      const matchingHash = (await computeSha256(validBytes))!
      const bytesArray = new Uint8Array(
        matchingHash.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      )

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: bytesArray }
        }
        if (method === 'get_score_history') {
          return []
        }
        return null
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => validBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('verified')
    })

    it('returns "mismatch" when computed hash differs from on-chain hash', async () => {
      const mismatchHash = 'f'.repeat(64)

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: mismatchHash }
        }
        if (method === 'get_score_history') {
          return []
        }
        return null
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => validBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('mismatch')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" on fetch failure (network error)', async () => {
      const matchingHash = (await computeSha256(validBytes))!

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: matchingHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error or connection refused'))
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" on fetch failure (HTTP 404 or 500 status)', async () => {
      const matchingHash = (await computeSha256(validBytes))!

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: matchingHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" when on-chain metadata_hash is missing or empty', async () => {
      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: undefined }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => validBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" when metadata_uri is missing', async () => {
      const matchingHash = (await computeSha256(validBytes))!

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_uri: undefined, metadata_hash: matchingHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" when crypto.subtle is unavailable', async () => {
      const matchingHash = (await computeSha256(validBytes))!

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: matchingHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => validBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const subtleSpy = vi
        .spyOn(globalThis.crypto, 'subtle', 'get')
        .mockReturnValue(undefined as unknown as SubtleCrypto)
      try {
        const res = await fetchProjectWithDetails(1)
        expect(res).not.toBeNull()
        expect(res?.verifiedMetadata).toBe('unverified')
        expect(mockSimulate).not.toHaveBeenCalledWith(
          'verify_metadata_hash',
          expect.anything(),
          expect.anything(),
        )
      } finally {
        subtleSpy.mockRestore()
      }
    })

    it('returns "unverified" on parse failure with a matching hash (fail closed)', async () => {
      const corruptBytes = new TextEncoder().encode('{ invalid json payload: ')
      const matchingHash = (await computeSha256(corruptBytes))!

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: matchingHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => corruptBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "mismatch" on parse failure with a non-matching hash', async () => {
      const corruptBytes = new TextEncoder().encode('{ invalid json payload: ')
      const storedMismatchHash = 'a'.repeat(64)

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: storedMismatchHash }
        }
        return []
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => corruptBytes.buffer,
      })
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('mismatch')
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns "unverified" on registry RPC error with fallback fixture', async () => {
      const mockSimulate = vi.fn().mockRejectedValue(new Error('RPC connection timeout'))
      setSimulateRegistryCall(mockSimulate)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')
    })

    it('never calls verify_metadata_hash with stored on-chain hash when metadata fetch fails', async () => {
      const storedOnChainHash = 'e1e2e3e4'.repeat(16)

      const mockSimulate = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'get_project') {
          return { ...baseRawProject, metadata_hash: storedOnChainHash }
        }
        return null
      })
      setSimulateRegistryCall(mockSimulate)

      const mockFetch = vi.fn().mockRejectedValue(new Error('Host 503 Service Unavailable'))
      vi.stubGlobal('fetch', mockFetch)

      const res = await fetchProjectWithDetails(1)
      expect(res).not.toBeNull()
      expect(res?.verifiedMetadata).toBe('unverified')

      // Ensure verify_metadata_hash is NEVER called, especially with storedOnChainHash
      const verifyCalls = mockSimulate.mock.calls.filter(
        (call) => call[0] === 'verify_metadata_hash',
      )
      expect(verifyCalls).toHaveLength(0)
      expect(mockSimulate).not.toHaveBeenCalledWith(
        'verify_metadata_hash',
        [1, storedOnChainHash],
        expect.anything(),
      )
    })
  })
})
