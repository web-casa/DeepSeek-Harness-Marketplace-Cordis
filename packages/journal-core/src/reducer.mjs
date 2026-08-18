// 严格纯函数 op 链归约：按物理行顺序解析，不排序修复证据。
import { targetKey } from './state.mjs'

const PHASES = ['INTENDED', 'CONFIRMED', 'CANCELLED']
const KINDS = ['FORWARD', 'ROLLBACK']
const HASH_RE = /^sha256:[0-9a-f]{64}$/

function validFileState(s) {
  if (!s || typeof s !== 'object' || typeof s.exists !== 'boolean') return false
  if (s.exists) return typeof s.hash === 'string' && HASH_RE.test(s.hash)
  return s.hash === null
}
function sameState(a, b) { return a && b && a.exists === b.exists && a.hash === b.hash }

function validateCommon(op, { txid, rel }) {
  if (op.v !== 1) throw { code: 'BAD_OP', message: 'op v != 1' }
  if (op.next.exists) {
    if (typeof op.length !== 'number' || !Number.isInteger(op.length) || op.length < 0) throw { code: 'BAD_OP', message: 'bad length for present next' }
    if (typeof op.mode !== 'string' || !/^0?[0-7]{3}$/.test(op.mode)) throw { code: 'BAD_OP', message: 'bad mode' }
  } else if (op.length !== undefined || op.mode !== undefined) {
    throw { code: 'BAD_OP', message: 'length/mode must be absent for absent next' }
  }
  if (op.txid !== txid) throw { code: 'BAD_OP', message: 'op txid mismatch' }
  if (op.targetKey !== targetKey(rel)) throw { code: 'BAD_OP', message: 'op targetKey mismatch' }
  if (!PHASES.includes(op.phase)) throw { code: 'BAD_OP', message: 'bad phase' }
  if (!KINDS.includes(op.kind)) throw { code: 'BAD_OP', message: 'bad kind' }
  if (!Number.isInteger(op.seq) || op.seq < 1) throw { code: 'BAD_OP', message: 'bad seq' }
  if (op.opId !== `${txid}-${op.seq}`) throw { code: 'BAD_OP', message: 'opId/seq mismatch' }
  if (!validFileState(op.expected) || !validFileState(op.next) || !validFileState(op.before)) throw { code: 'BAD_OP', message: 'bad file state' }
}

/**
 * 物理顺序解析：INTENDED 后必须紧接同一 opId 的 terminal phase；
 * 只有日志最后一条 INTENDED 可以 pending；seq 必须按物理顺序连续递增。
 */
export function parseOpLog(lines, { txid, rel }) {
  const groups = []
  let current = null
  let expectedSeq = 1
  let truncatedTail = false
  lines.forEach((line, index) => {
    if (line === '') return
    let op
    try { op = JSON.parse(line) } catch {
      if (index === lines.length - 1) { truncatedTail = true; return }
      throw { code: 'BAD_OP', message: `bad json line ${index}` }
    }
    validateCommon(op, { txid, rel })
    if (op.phase === 'INTENDED') {
      if (op.seq !== expectedSeq) throw { code: 'BAD_OP', message: `physical seq gap: expected ${expectedSeq} got ${op.seq}` }
      if (current && current.length === 1) throw { code: 'BAD_OP', message: 'unresolved op before new INTENDED' }
      current = [op]
      groups.push(current)
      expectedSeq = op.seq + 1
      return
    }
    // terminal phase
    if (!current) throw { code: 'BAD_OP', message: 'terminal phase without INTENDED' }
    if (current[0].opId !== op.opId || current[0].seq !== op.seq) throw { code: 'BAD_OP', message: 'terminal opId/seq mismatch' }
    if (current.length >= 2) throw { code: 'BAD_OP', message: 'duplicate terminal phase' }
    for (const k of ['seq', 'opId', 'kind', 'expected', 'next', 'before', 'mode', 'length', 'v', 'txid', 'targetKey']) {
      if (JSON.stringify(current[0][k]) !== JSON.stringify(op[k])) throw { code: 'BAD_OP', message: `phase records differ: ${k}` }
    }
    current.push(op)
  })
  const records = groups.flat()
  return { records, groups, truncatedTail }
}

/**
 * 纯逻辑归约：before 恒等于 baseline；expected 按前一 owned 串链；
 * ROLLBACK.next 必须回到 baseline。
 */
export function reduceOps(parsed, baseline) {
  const { groups } = parsed
  let owned = baseline.state
  groups.forEach((group) => {
    const op = group[0]
    // working draft v7.1：before 表示 op 开始前 owned，且必须等于 expected
    if (!sameState(op.before, owned)) throw { code: 'BAD_OP', message: 'op before != previous owned' }
    if (!sameState(op.expected, owned)) throw { code: 'BAD_OP', message: 'expected chain mismatch' }
    if (op.kind === 'ROLLBACK' && !sameState(op.next, baseline.state)) throw { code: 'BAD_OP', message: 'rollback next != baseline' }
    const final = group[group.length - 1]
    if (final.phase === 'CONFIRMED') owned = final.next
  })
  const last = groups.length ? groups[groups.length - 1] : null
  const pending = last && last.length === 1 && last[0].phase === 'INTENDED' ? last[0] : null
  return { owned, pending, records: parsed.records, groups }
}

export function classifyTarget(parsed, baseline, current) {
  const { owned, pending } = reduceOps(parsed, baseline)
  if (pending) {
    if (sameState(current, pending.expected)) return { conflict: false, owned, pending, pendingAction: 'CANCELLED' }
    if (sameState(current, pending.next)) return { conflict: false, owned: pending.next, pending, pendingAction: 'CONFIRMED' }
    return { conflict: true, owned, pending, pendingAction: null }
  }
  if (!sameState(current, owned)) return { conflict: true, owned, pending: null, pendingAction: null }
  return { conflict: false, owned, pending: null, pendingAction: null }
}

export function rollbackRequired(plan, baseline) { return !sameState(plan.owned, baseline.state) }
