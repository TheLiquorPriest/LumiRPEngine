import { describe, expect, test } from 'bun:test'
import { ALL_PERMISSIONS } from 'lumiverse-spindle-types'
import manifest from '../spindle.json'

describe('spindle.json', () => {
  test('identifier matches the Spindle pattern', () => {
    expect(manifest.identifier).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  test('every declared permission is a known Spindle permission', () => {
    const known: readonly string[] = ALL_PERMISSIONS
    expect(manifest.permissions.filter((permission) => !known.includes(permission))).toEqual([])
  })

  test('entries live under dist/', () => {
    expect(manifest.entry_backend.startsWith('dist/')).toBe(true)
    expect(manifest.entry_frontend.startsWith('dist/')).toBe(true)
  })
})
