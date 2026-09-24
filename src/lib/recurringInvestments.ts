export interface RecurringInvestmentPlan {
  bondId: string
  amount: number
  dayOfMonth: number
  createdAt: string
  active: boolean
}

const STORAGE_KEY = 'heliobond:recurring-investment-plans'

export function saveRecurringInvestment(
  plan: Omit<RecurringInvestmentPlan, 'createdAt' | 'active'>,
): RecurringInvestmentPlan {
  const next: RecurringInvestmentPlan = {
    ...plan,
    createdAt: new Date().toISOString(),
    active: true,
  }
  if (typeof window === 'undefined') return next
  const existing = readRecurringInvestments()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, next]))
  return next
}

export function readRecurringInvestments(): RecurringInvestmentPlan[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as RecurringInvestmentPlan[]) : []
  } catch {
    return []
  }
}
