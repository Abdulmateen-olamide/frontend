import { describe, it, expect } from 'vitest'
import robots from './robots'
import sitemap from './sitemap'
import { DEV_ROUTES, devRoutesEnabled } from '../lib/devRoutes'

describe('dev-only routes (#606)', () => {
  it('are disallowed in robots.txt', () => {
    const rules = robots().rules
    const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow
    for (const route of DEV_ROUTES) expect(disallow).toContain(route)
  })

  it('are not listed in the sitemap', () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname)
    for (const route of DEV_ROUTES) {
      expect(urls.some((path) => path.startsWith(route))).toBe(false)
    }
  })

  it('are enabled in development and disabled in production', () => {
    expect(devRoutesEnabled('development', undefined)).toBe(true)
    expect(devRoutesEnabled('test', undefined)).toBe(true)
    expect(devRoutesEnabled('production', undefined)).toBe(false)
  })

  it('honour the NEXT_PUBLIC_ENABLE_DEV_ROUTES override', () => {
    expect(devRoutesEnabled('production', 'true')).toBe(true)
    expect(devRoutesEnabled('development', 'false')).toBe(false)
  })
})
