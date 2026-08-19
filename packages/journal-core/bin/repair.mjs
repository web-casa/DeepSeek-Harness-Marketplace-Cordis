#!/usr/bin/env node
// cordis-mp repair：独立于 DSH/Cordis 的 journal 恢复 CLI。
import { resolve } from 'node:path'
import { Journal } from '../src/journal.mjs'
import { ResolutionJournal } from '../src/resolution.mjs'
import { FileLock, withFileLock } from '../src/lock.mjs'

const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--journal-root') opt.journalRoot = resolve(args[++i])
  else if (args[i] === '--profile-root') opt.profileRoot = resolve(args[++i])
}
if (!opt.journalRoot || !opt.profileRoot) {
  console.error('usage: cordis-mp repair --journal-root <dir> --profile-root <dir>')
  process.exit(2)
}
const lock = new FileLock(opt.journalRoot)
const journal = new Journal({ ...opt, lock })
const resolutions = new ResolutionJournal(journal, { lock })
const { report, rreport } = await withFileLock(lock, 'repair-action', async () => ({
  report: await journal.recoverReport(),
  rreport: await resolutions.recoverReport(),
}))
console.log(JSON.stringify({ journal: report, resolutions: rreport }, null, 2))
const fatal = [...report.entries, ...rreport.entries].some(e => ['BAD_MANIFEST','BAD_OP','SNAPSHOT_MISSING','SNAPSHOT_BAD'].includes(e.result))
process.exit(fatal ? 1 : 0)
