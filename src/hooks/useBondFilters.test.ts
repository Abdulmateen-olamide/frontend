import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBondFilters } from './useBondFilters'

describe('useBondFilters', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', 'http://localhost:3000/portfolio')
  })

  it('initializes with default values when URL and storage are empty', () => {
    const { result } = renderHook(() => useBondFilters())
    expect(result.current.yieldRange).toEqual([0, 15])
    expect(result.current.sortOrder).toBe('asc')
    expect(result.current.sortDirection).toBe('asc')
  })

  it('initializes from URL query parameters (bookmark/share link)', () => {
    window.history.replaceState(
      null,
      '',
      'http://localhost:3000/portfolio?sortOrder=desc&yieldRange=4-10',
    )
    const { result } = renderHook(() => useBondFilters())
    expect(result.current.sortOrder).toBe('desc')
    expect(result.current.sortDirection).toBe('desc')
    expect(result.current.yieldRange).toEqual([4, 10])
  })

  it('updates sortOrder and persists to URL and storage', () => {
    const { result } = renderHook(() => useBondFilters())
    act(() => {
      result.current.setSortOrder('desc')
    })
    expect(result.current.sortOrder).toBe('desc')
    expect(result.current.sortDirection).toBe('desc')
    expect(window.location.search).toContain('sortOrder=desc')
    expect(localStorage.getItem('bond_sort_order')).toBe('desc')
  })

  it('updates sortDirection via setSortDirection alias', () => {
    const { result } = renderHook(() => useBondFilters())
    act(() => {
      result.current.setSortDirection('desc')
    })
    expect(result.current.sortOrder).toBe('desc')
    expect(window.location.search).toContain('sortOrder=desc')
  })

  it('syncs across storage events (tab switches)', () => {
    const { result } = renderHook(() => useBondFilters())
    expect(result.current.sortOrder).toBe('asc')

    act(() => {
      localStorage.setItem('bond_sort_order', 'desc')
      window.dispatchEvent(new Event('storage'))
    })
    expect(result.current.sortOrder).toBe('desc')
  })
})
