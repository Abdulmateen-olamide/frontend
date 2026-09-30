/**
 * Repo-hygiene guard (#653). Editor swap files and one-off PR write-ups used to be
 * committed at the root; they clutter the tree and show up in Prettier and search
 * results. This test fails the build if they come back.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { DEV_ROUTES } from '../lib/devRoutes'
import { ROUTES } from '../lib/routeMetadata'

const ROOT = path.resolve(__dirname, '..', '..')
const SWAP = /\.(swp|swo|swn)$/

/** Only the top level plus one level of dirs — swap files never live deeper. */
function walk(dir: string, depth = 1): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.git' || entry === '.next') return []
    const full = path.join(dir, entry)
    if (!statSync(full).isDirectory()) return [full]
    return depth > 0 ? walk(full, depth - 1) : []
  })
}

const tracked = walk(ROOT).map((file) => path.relative(ROOT, file))

describe('repo hygiene (#653)', () => {
  it('has no committed editor swap/backup files', () => {
    expect(tracked.filter((file) => SWAP.test(file))).toEqual([])
  })

  it('ignores swap/backup patterns in .gitignore', () => {
    const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    for (const pattern of ['*.swp', '*.swo', '*~']) expect(gitignore).toContain(pattern)
  })

  it('has no leftover single-PR write-ups at the root', () => {
    const leftovers = [
      'PR_DESCRIPTION.md',
      'pr-description.md',
      'IMPLEMENTATION_SUMMARY.md',
    ].filter((name) => existsSync(path.join(ROOT, name)))
    expect(leftovers).toEqual([])
  })

  it('does not track .vscode/ settings that .gitignore also lists', () => {
    const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.vscode/')
    expect(gitignore).not.toContain('!.vscode/settings.json')
  })
})

/**
 * The README drifted from the code more than once (#659): a stale locale list, a
 * stale route list, and a claim that the vault was simulated when it builds and
 * submits real transactions. These checks fail when the docs go stale again.
 */
describe('README accuracy (#659)', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')

  it('lists every locale in the message catalog', () => {
    for (const file of readdirSync(path.join(ROOT, 'messages'))) {
      expect(readme).toContain(file)
    }
  })

  it('does not state a message key count that can go stale', () => {
    expect(readme).not.toMatch(/\b\d{2,}\s+keys\b/i)
  })

  it('lists every route segment that src/app renders', () => {
    const routes = [
      ...ROUTES.map((r) => r.path),
      '/project/[id]', // resolves its own metadata per record
      ...DEV_ROUTES,
    ]
    for (const route of routes) {
      if (route === '/') continue // the README calls it "the landing hero"
      expect(readme).toContain(route)
    }
  })

  it('no longer claims the on-chain calls are the unshipped work', () => {
    // The stale wording called the vault client simulated and listed "real
    // on-chain calls" as future work. Both have shipped; a fallback being
    // described as a fallback is fine.
    expect(readme).not.toMatch(/vault client is simulated/i)
    expect(readme).not.toMatch(/real on-chain calls/i)
    expect(readme).toMatch(/builds, signs and submits real Soroban transactions/i)
  })

  it('separates what is on-chain, env-var dependent and fixture data', () => {
    expect(readme).toContain('## What runs where')
    expect(readme).toMatch(/on-chain when the contract ID is set/i)
    expect(readme).toMatch(/fixture/i)
  })
})
