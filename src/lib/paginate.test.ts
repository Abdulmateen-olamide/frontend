import { describe, expect, it } from 'vitest'
import { paginateItems } from './paginate'

describe('paginateItems', () => {
  it('keeps large activity feeds bounded to the visible page', () => {
    const activity = Array.from({ length: 53 }, (_, index) => `activity-${index + 1}`)
    expect(paginateItems(activity, 1, 10)).toHaveLength(10)
    expect(paginateItems(activity, 1, 10)[0]).toBe('activity-1')
    expect(paginateItems(activity, 2, 10)[0]).toBe('activity-11')
    expect(paginateItems(activity, 6, 10)).toEqual(['activity-51', 'activity-52', 'activity-53'])
    expect(paginateItems(activity, 7, 10)).toEqual([])
  })

  it.each([
    [0, 10],
    [1, 0],
    [-1, 10],
  ])('rejects invalid page inputs %i / %i', (page, size) => {
    expect(() => paginateItems([1], page, size)).toThrow(RangeError)
  })
})
