import { describe, it, expect, beforeEach } from 'vitest'
import {
  mapOnChainProject,
  fetchTotalProjects,
  fetchProjectsPage,
  fetchProjectWithDetails,
  fetchScoreHistory,
  clearRegistryCache,
  isRegistryConfigured,
} from './registry'

describe('registry client', () => {
  beforeEach(() => {
    clearRegistryCache()
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
    expect(detail?.verifiedMetadata).toBe(true)

    const scores = await fetchScoreHistory(1)
    expect(scores.credit.length).toBeGreaterThan(0)
    expect(scores.green.length).toBeGreaterThan(0)
  })
})
