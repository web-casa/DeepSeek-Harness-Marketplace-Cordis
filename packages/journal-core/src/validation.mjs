// BaselineValidator 结果 ticket：只有 createValidationEvidence 能构造。
const BRAND = Symbol('cordis-mp.validation-evidence')

export function createValidationEvidence(baselineReport, fingerprint) {
  if (!baselineReport || baselineReport.ok !== true) throw new TypeError('baselineReport.ok must be true')
  if (typeof fingerprint !== 'string') throw new TypeError('fingerprint required')
  const evidence = { valid: true, baselineReport, fingerprint }
  Object.defineProperty(evidence, BRAND, { value: true, enumerable: false })
  return evidence
}
export function isValidationEvidence(value) {
  return !!value && value[BRAND] === true
}
