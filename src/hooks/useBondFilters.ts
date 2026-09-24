'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  getPersistedYieldRange,
  persistYieldRange,
  getPersistedSortOrder,
  persistSortOrder,
  type SortDirection,
} from '@/lib/bondUtils'

export function useBondFilters() {
  const [yieldRange, setYieldRangeState] = useState<[number, number]>(getPersistedYieldRange)
  const [sortOrder, setSortOrderState] = useState<SortDirection>(getPersistedSortOrder)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYieldRangeState(getPersistedYieldRange())
    setSortOrderState(getPersistedSortOrder())
  }, [])

  const setYieldRange = useCallback((range: [number, number]) => {
    setYieldRangeState(range)
    persistYieldRange(range)
  }, [])

  const setSortOrder = useCallback((direction: SortDirection) => {
    setSortOrderState(direction)
    persistSortOrder(direction)
  }, [])

  // Persist across tab switches, history navigation (popstate), and bfcache restores (pageshow)
  useEffect(() => {
    const handler = () => {
      setYieldRangeState(getPersistedYieldRange())
      setSortOrderState(getPersistedSortOrder())
    }
    window.addEventListener('storage', handler)
    window.addEventListener('popstate', handler)
    window.addEventListener('pageshow', handler)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') handler()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener('popstate', handler)
      window.removeEventListener('pageshow', handler)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return {
    yieldRange,
    setYieldRange,
    sortOrder,
    setSortOrder,
    sortDirection: sortOrder,
    setSortDirection: setSortOrder,
  }
}

export default useBondFilters
