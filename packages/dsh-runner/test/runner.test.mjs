import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DshRunner } from '../src/index.js'

function child(pid, { onKill = null } = {}) {
  const result = new EventEmitter()
  result.pid = pid
  result.stdout = new EventEmitter()
  result.stderr = new EventEmitter()
  result.kill = () => { result.killed = true; onKill?.(); return true }
  return result
}

test('an old child close event cannot clear a newer active runner command', async () => {
  const children = [child(900_001), child(900_002)]
  const runner = new DshRunner({ spawnImpl() { return children.shift() } })

  const first = runner.run(['one'])
  const firstChild = runner.active
  firstChild.emit('error', new Error('first failed'))
  const firstResult = await first
  assert.equal(firstResult.exitCode, 127)
  assert.equal(runner.active, null)

  const second = runner.run(['two'])
  const secondChild = runner.active
  firstChild.emit('close', 1)
  assert.equal(runner.active, secondChild)
  assert.equal((await runner.run(['three'])).busy, true)

  secondChild.emit('close', 0)
  assert.equal((await second).exitCode, 0)
  assert.equal(runner.active, null)
})

test('a synchronous spawn failure becomes a stable command diagnostic', async () => {
  const runner = new DshRunner({ spawnImpl() { throw new Error('spawn unavailable') } })
  const result = await runner.run(['--version'])
  assert.equal(result.exitCode, 127)
  assert.match(result.stderr, /spawn unavailable/)
  assert.equal(runner.active, null)
})

test('an already-aborted signal still observes a synchronous child close', async () => {
  let abortedChild
  abortedChild = child(99_999_999, { onKill() { abortedChild.emit('close', null) } })
  const controller = new AbortController()
  controller.abort()
  const runner = new DshRunner({ spawnImpl() { return abortedChild } })
  const result = await runner.run(['long-command'], { signal: controller.signal })
  assert.equal(abortedChild.killed, true)
  assert.equal(result.cancelled, true)
  assert.equal(result.exitCode, null)
  assert.equal(runner.active, null)
})
