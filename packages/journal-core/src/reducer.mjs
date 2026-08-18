// 严格纯函数 op 链归约：JournalEvidence -> ValidationResult
// 不做任何 I/O；调用方负责提供 records 与 baseline。
import { targetKey } from './state.mjs'

const PHASES = ['INTENDED', 'CONFIRMED', 'CANCELLED']
const KINDS = ['FORWARD', 'ROLLBACK']

function validFileState(s) {
  if (!s || typeof s !== 'object' || typeof s.exists !== 'boolean') return false
  if (s.exists) return typeof s.hash === 'string' && s.hash.startsWith('sha256:') && s.hash.length === 7 + 64
  return s.hash === null || s.hash === undefined
}
function sameState(a, b) { return a && b && a.exists === b.exists && a.hash === b.hash }

/**
 * 解析并验证一个 target 的 op JSONL。
 * 返回 { records, groups, owned, pending, truncatedTail }
 * 任何结构错误抛出 { code:'BAD_OP', message }。
 */
export function parseOpLog(lines, { txid, rel }) {
  const key = targetKey(rel)
  const groups = new Map()
  let truncatedTail = false
  lines.forEach((line, index) => {
    if (line === '') return
    let op
    try { op = JSON.parse(line) } catch {
      if (index === lines.length - 1) { truncatedTail = true; return }
      throw { code: 'BAD_OP', message: `bad json line ${index}` }
    }
    if (op.v !== 1) throw { code: 'BAD_OP', message: 'op v != 1' }
    if (op.txid !== txid) throw { code: 'BAD_OP', message: 'op txid mismatch' }
    if (op.targetKey !== key) throw { code: 'BAD_OP', message: 'op targetKey mismatch' }
    if (!PHASES.includes(op.phase)) throw { code: 'BAD_OP', message: 'bad phase' }
    if (!KINDS.includes(op.kind)) throw { code: 'BAD_OP', message: 'bad kind' }
    if (!Number.isInteger(op.seq) || op.seq < 1) throw { code: 'BAD_OP', message: 'bad seq' }
    if (op.opId !== `${txid}-${op.seq}`) throw { code: 'BAD_OP', message: 'opId/seq mismatch' }
    if (!validFileState(op.expected) || !validFileState(op.next) || !validFileState(op.before)) throw { code: 'BAD_OP', message: 'bad file state' }
    const g = groups.get(op.opId)
    if (!g) { if (op.phase !== 'INTENDED') throw { code: 'BAD_OP', message: 'first phase must be INTENDED' }; groups.set(op.opId, [op]) } else {
      const first = g[0]
      if (g.length >= 2) throw { code: 'BAD_OP', message: 'more than 2 phases for op' }
      if (first.phase === op.phase) throw { code: 'BAD_OP', message: 'duplicate phase' }
      if (!['CONFIRMED', 'CANCELLED'].includes(op.phase)) throw { code: 'BAD_OP', message: 'bad second phase' }
      for (const k of ['seq', 'opId', 'kind', 'expected', 'next', 'before', 'mode', 'length', 'v', 'txid', 'targetKey']) {
        if (JSON.stringify(first[k]) !== JSON.stringify(op[k])) throw { code: 'BAD_OP', message: `phase records differ: ${k}` }
      }
      g.push(op)
    }
  })
  // 按 seq 排序并验证连续
  const seqs = [...groups.keys()].map(k => groups.get(k)[0].seq).sort((a, b) => a - b)
  seqs.forEach((seq, i) => { if (seq !== i + 1) throw { code: 'BAD_OP', message: `seq gap: expected ${i + 1} got ${seq}` } })
  const records = seqs.flatMap(seq => groups.get(`${txid}-${seq}`))
  return { records, groups, truncatedTail }
}

/**
 * 纯逻辑归约：验证 op 链并计算 owned / pending。
 */
export function reduceOps(parsed, baseline) {
  const { records, groups } = parsed
  let owned = baseline.state
  let first = true
  let index = 0
  const groupList = [...groups.values()]
  for (const group of groupList) {
    index++
    if (index < groupList.length && group.length !== 2) throw { code: 'BAD_OP', message: 'unresolved op before last' }

    const op = group[0]
    if (op.before.exists !== baseline.state.exists || op.before.hash !== baseline.state.hash) throw { code: 'BAD_OP', message: 'op before != baseline' }
    if (op.kind === 'ROLLBACK' && !sameState(op.next, baseline.state)) throw { code: 'BAD_OP', message: 'rollback next != baseline' }
    const expected = first ? baseline.state : owned
    if (!sameState(op.expected, expected)) throw { code: 'BAD_OP', message: 'expected chain mismatch' }
    first = false
    const final = group[group.length - 1]
    if (final.phase === 'CONFIRMED') owned = final.next
  }
  const pending = records.length && records[records.length - 1].phase === 'INTENDED' ? records[records.length - 1] : null
  return { owned, pending, records, groups }
}

/**
 * 物理 current 判定，返回不可变 RecoveryTargetPlan。
 */
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

export function rollbackRequired(plan, baseline) {
  return !sameState(plan.owned, baseline.state)
}
