import { describe, it, expect } from 'vitest'
import { getProjects, getProject, createInvestment } from './api'

describe('api', () => {
  it('returns mock data for getProjects', async () => {
    expect(await getProjects()).toBeDefined()
  })

  it('rejects invalid project ids to prevent injection', async () => {
    await expect(getProject(-1)).resolves.toBeNull()
    await expect(getProject(NaN)).resolves.toBeNull()
    await expect(getProject(1.5)).resolves.toBeNull()
    await expect(getProject(0)).resolves.toBeNull()
  })

  it('rejects invalid investment input', async () => {
    await expect(createInvestment({ projectId: -1, amount: 100 })).rejects.toThrow(
      'Invalid investment input',
    )
    await expect(createInvestment({ projectId: 1, amount: -100 })).rejects.toThrow(
      'Invalid investment input',
    )
    await expect(createInvestment({ projectId: NaN, amount: 100 })).rejects.toThrow(
      'Invalid investment input',
    )
  })

  it('creates investment with valid input', async () => {
    const investment = await createInvestment({ projectId: 1, amount: 100 })
    expect(investment.projectId).toBe(1)
    expect(investment.amount).toBe(100)
    expect(investment.projectUrl).toBe('/projects/1')
  })
})
