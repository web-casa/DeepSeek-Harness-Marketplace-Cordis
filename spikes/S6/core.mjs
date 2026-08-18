// install-core 原型：只依赖 EffectPorts，不 import DSH/Tauri/CLI
export async function installVerifiedPlugin(ports, plan, signal) {
  const tx = await ports.journal.begin(plan)
  try {
    if (signal?.aborted) throw new Error('ABORTED')
    const result = await ports.packageManager.installLocalVerifiedArtifact(plan, signal)
    if (result.exitCode !== 0) throw new Error('INSTALL_FAILED')
    const verified = await ports.verify.verifyInstalled(plan)
    if (!verified.ok) throw new Error('VERIFY_FAILED')
    await ports.journal.commit(tx)
    if (plan.activate !== false) {
      const act = await ports.activation.requestActivation(plan.entryIds, signal)
      if (act.status === 'RESTART_REQUIRED') return { status: 'RESTART_PENDING' }
      if (act.status !== 'ACTIVE') throw new Error('ACTIVATION_FAILED')
    }
    return { status: 'ACTIVE' }
  } catch (e) {
    if (e.message !== 'ABORTED') await ports.journal.rollback({ id: tx.id, plan })
    return { status: 'ROLLED_BACK', error: e.message }
  }
}
