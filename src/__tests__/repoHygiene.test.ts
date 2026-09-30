/**
 * Repo-hygiene guard (#653). Editor swap files and one-off PR write-ups used to be
 * committed at the root; they clutter the tree and show up in Prettier and search
 * results. This test fails the build if they come back.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

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
