// catalog-core 原型：只实现 v4 schema 关键校验，输出可安装性决策
const NPM_NAME=/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
export function parseCatalog(body){
  if (body?.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
  if (typeof body.catalogRevision !== 'string' || !body.catalogRevision) throw new Error('catalogRevision required')
  if (!Array.isArray(body.items)) throw new Error('items must be array')
  return body
}
export function installability(item, targetPlatform='web'){
  const reason=[]
  if (item.source?.type !== 'npm') reason.push('non-npm-source')
  else {
    const s=item.source
    if (!NPM_NAME.test(s.packageName)) reason.push('bad-package-name')
    if (typeof s.version !== 'string' || !/^\d+\.\d+\.\d+/.test(s.version)) reason.push('bad-version')
    if (typeof s.integrity !== 'string' || !s.integrity.startsWith('sha512-')) reason.push('missing-integrity')
    if (s.registry !== 'https://registry.npmjs.org') reason.push('registry-not-allowed')
    if (s.tarball && new URL(s.tarball).hostname !== new URL(s.registry).hostname) reason.push('tarball-host-mismatch')
  }
  if (!Array.isArray(item.platforms)) reason.push('platforms-missing')
  else if (!item.platforms.includes(targetPlatform)) reason.push('platform-'+item.platforms.join('+'))
  if (item.blocked === true) reason.push('blocked')
  if (item.deprecated === true) reason.push('deprecated')
  return { installable: reason.length===0, reason: reason.join(',') }
}
