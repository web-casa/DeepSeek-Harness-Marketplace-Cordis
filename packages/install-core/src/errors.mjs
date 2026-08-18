export class InstallError extends Error {
  constructor(code, message){ super(message); this.code = code }
}
