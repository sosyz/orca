import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readFlattenedMobileTasksHookSignatures,
  readMobileTasksSemanticSource,
  readMobileTasksStyleSource
} from './mobile-tasks-source-family.test-support'
import { readFlattenedMobileTasksRenderTokens } from './mobile-tasks-render-parity.test-support'
import {
  readFlattenedMobileTasksCoreStatements,
  readMobileTasksDeclarationSignatures
} from './mobile-tasks-execution-parity.test-support'

const hash = (parts: string[] | string): string =>
  createHash('sha256')
    .update(Array.isArray(parts) ? parts.join('\n') : parts)
    .digest('hex')

const TASKS_SCREEN_HOOKS = '238424fd2605f33867d6be50388ff3262651c1a94b2ec5d5b0aa7a15ef4de77f'
const TASKS_DIFF_HOOKS = '93c7189b32bed8456cc51814fffa8ce80cf62011ef968a9d53ddec2b9686f58f'
const TASKS_STATEMENTS = 'ab03f364fdc971de87537a89dc98611b7b43f1024398def8204504d02e2fb15f'
const TASKS_DECLARATIONS = 'cff54172af17a877789be1479c2eb6ca97d83c3e31dd831cd59395962f2b4c4a'
const TASKS_SEMANTICS = '03f2f05e0711c68584ab1ad483a25bb8eb35879a3ea6c5f5c5244824babed58a'
const TASKS_STYLES = '1db6af69c791d9963928541ad5310942fcbda6d984b422c90b6eb92b6816579a'
const TASKS_RENDER_TREE = '25568e13f243d91261af78fe58a0dc25ae008bd50c9f06c4d90cc896b57a89fa'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(356)
    expect(hash(screenHooks)).toBe(TASKS_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(3)
    expect(hash(diffHooks)).toBe(TASKS_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(423)
    expect(hash(statements)).toBe(TASKS_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(193)
    expect(hash(declarations)).toBe(TASKS_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(3_533)
    expect(hash(semantics)).toBe(TASKS_SEMANTICS)
  })

  it('preserves render expressions and event handlers in tree order', () => {
    const tokens = readFlattenedMobileTasksRenderTokens()
    expect(tokens).toHaveLength(35_273)
    expect(hash(tokens)).toBe(TASKS_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(TASKS_STYLES)
  })
})
