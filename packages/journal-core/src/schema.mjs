// 统一版本化 schema 校验（G7）。
const HASH_RE = /^sha256:[0-9a-f]{64}$/

export function isFileState(s) {
  if (!s || typeof s !== 'object' || typeof s.exists !== 'boolean') return false
  if (s.exists) return typeof s.hash === 'string' && HASH_RE.test(s.hash)
  return s.hash === null
}
export function validateFileState(s, name = 'state') {
  if (!isFileState(s)) throw new Error(`${name} is not a valid FileState`)
  return s
}
export function validateBaseline(b) {
  if (!b || !isFileState(b.state)) throw new Error('baseline.state invalid')
  if (b.state.exists) {
    if (!Number.isInteger(b.length) || b.length < 0) throw new Error('baseline.length invalid')
    if (typeof b.mode !== 'string' || !/^0?[0-7]{3}$/.test(b.mode)) throw new Error('baseline.mode invalid')
  }
  return b
}
export function validateManifest(m) {
  if (!m || m.v !== 1 || typeof m.txid !== 'string' || typeof m.createdAt !== 'number') throw new Error('manifest header invalid')
  if (!['PREPARING','PREPARED','MUTATING','FILE_COMMITTED','CONFLICTED'].includes(m.state)) throw new Error('manifest state invalid')
  if (!m.targets || typeof m.targets !== 'object' || Object.keys(m.targets).length === 0) throw new Error('manifest targets empty')
  for (const [rel, b] of Object.entries(m.targets)) {
    if (typeof rel !== 'string' || rel.length === 0 || rel.includes('..') || rel.startsWith('/')) throw new Error('manifest target rel invalid')
    validateBaseline(b)
  }
  return m
}
export function validateOutcome(o) {
  if (!o || o.v !== 1 || typeof o.txid !== 'string' || !['ROLLED_BACK','COMMITTED'].includes(o.outcome)) throw new Error('outcome invalid')
  return o
}
export function validateConflictReport(r) {
  if (!r || r.v !== 1 || typeof r.txid !== 'string' || !Array.isArray(r.conflicts)) throw new Error('report invalid')
  for (const c of r.conflicts) {
    if (!c || typeof c.rel !== 'string' || !isFileState(c.state)) throw new Error('report conflict invalid')
  }
  if (r.evidence !== undefined) {
    if (!Array.isArray(r.evidence)) throw new Error('report evidence invalid')
    for (const e of r.evidence) {
      if (!e || typeof e.name !== 'string' || typeof e.hash !== 'string' || !Number.isInteger(e.length) || e.length < 0) throw new Error('report evidence entry invalid')
    }
  }
  return r
}
export function validateResolutionManifest(m) {
  if (!m || m.v !== 1 || typeof m.resolutionId !== 'string' || typeof m.txid !== 'string' || typeof m.createdAt !== 'number') throw new Error('resolution manifest header invalid')
  if (!['restore-snapshot','accept-current'].includes(m.action)) throw new Error('resolution action invalid')
  if (!['PLANNED','RESOLVING','RESOLUTION_CONFLICTED'].includes(m.state)) throw new Error('resolution state invalid')
  if (m.supersedes !== null && m.supersedes !== undefined && typeof m.supersedes !== 'string') throw new Error('resolution supersedes invalid')
  if (m.action === 'restore-snapshot') {
    if (!m.plan || typeof m.plan !== 'object' || Object.keys(m.plan).length === 0) throw new Error('resolution plan missing')
    for (const [rel, p] of Object.entries(m.plan)) {
      if (typeof rel !== 'string') throw new Error('resolution plan rel invalid')
      validateFileState(p?.expected, `plan.${rel}.expected`)
      validateFileState(p?.next, `plan.${rel}.next`)
    }
  } else if (m.plan !== null && m.plan !== undefined) throw new Error('accept-current plan must be absent')
  return m
}
export function validateValidation(v) {
  if (!v || v.v !== 1 || typeof v.resolutionId !== 'string' || v.valid !== true || typeof v.fingerprint !== 'string') throw new Error('validation invalid')
  return v
}

const RESULT_ENUM = ['CLEAN','COMMITTED_OK','ROLLED_BACK','CONFLICTED','CONFLICTED_EXISTING',
  'BAD_MANIFEST','BAD_OUTCOME','BAD_REPORT','BAD_EVIDENCE','SNAPSHOT_MISSING','SNAPSHOT_BAD',
  'BAD_OP','ACTIVE_TX','RESOLVED','RESOLUTION_CONFLICTED','ACCEPTED_CURRENT','SUPERSEDED',
  'WAITING_AUTHORIZATION','WAITING_VALIDATION','CLEANED_TERMINAL','CLEANED_SUPERSEDED','NO_HEAD','BAD_GRAPH','MULTIPLE_HEADS','BAD_PLAN','BAD_ACTION','BAD_VALIDATION','NO_VALIDATOR','JOURNALLED','NOT_TERMINAL','FINGERPRINT_MISMATCH','UNRECOVERABLE_RESTORE','NO_VALIDATION']

export function makeRecoveryReport(entries) {
  const report = { v: 1, entries }
  validateRecoveryReport(report)
  return report
}
export function validateRecoveryReport(r) {
  if (!r || r.v !== 1 || !Array.isArray(r.entries)) throw new Error('recovery report invalid')
  for (const e of r.entries) {
    if (!e || typeof e.txid !== 'string' || !RESULT_ENUM.includes(e.result)) throw new Error('recovery report entry invalid')
  }
  return r
}
export function makeResolutionOutcome(resolutionId, txid, outcome) {
  const o = { v: 1, resolutionId, txid, outcome }
  validateResolutionOutcome(o)
  return o
}
export function validateResolutionOutcome(o) {
  if (!o || o.v !== 1 || typeof o.resolutionId !== 'string' || typeof o.txid !== 'string') throw new Error('resolution outcome header invalid')
  if (!['RESOLVED','RESOLUTION_CONFLICTED','ACCEPTED_CURRENT','SUPERSEDED'].includes(o.outcome)) throw new Error('resolution outcome enum invalid')
  return o
}
