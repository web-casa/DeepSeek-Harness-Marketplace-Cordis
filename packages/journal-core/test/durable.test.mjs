import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fsyncDescriptor } from '../src/durable.mjs'

function fsyncError(code) {
  const error = new Error('fsync failed')
  error.code = code
  return error
}

test('only known Windows fsync limitations downgrade to BEST_EFFORT', () => {
  const warnings = []
  for (const code of ['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP']) {
    assert.equal(fsyncDescriptor(1, {
      platform: 'win32',
      fsync() { throw fsyncError(code) },
      warn(message) { warnings.push(message) },
    }), false)
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /BEST_EFFORT/)

  assert.throws(() => fsyncDescriptor(1, {
    platform: 'linux',
    fsync() { throw fsyncError('EPERM') },
  }), error => error.code === 'EPERM')
  assert.throws(() => fsyncDescriptor(1, {
    platform: 'win32',
    fsync() { throw fsyncError('EIO') },
  }), error => error.code === 'EIO')
  assert.equal(fsyncDescriptor(1, { fsync() {} }), true)
})
