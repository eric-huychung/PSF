// In-memory stand-in for the File System Access API, which jsdom does not implement.
// Only models what the storage layer uses. Test-only: never import from app code.

function notFound(name: string): DOMException {
  return new DOMException(`A requested file or directory could not be found: ${name}`, 'NotFoundError')
}

export class FakeFileHandle {
  readonly kind = 'file'
  readonly name: string
  private readonly parent: FakeDirectoryHandle

  constructor(parent: FakeDirectoryHandle, name: string) {
    this.parent = parent
    this.name = name
  }

  async getFile(): Promise<File> {
    this.parent.assertAccess()
    const content = this.parent.files.get(this.name)
    if (content === undefined) throw notFound(this.name)
    return new File([content], this.name)
  }

  async createWritable() {
    this.parent.assertAccess()
    let buffer = ''
    return {
      write: async (data: string) => {
        buffer += data
      },
      close: async () => {
        this.parent.files.set(this.name, buffer)
      },
    }
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory'
  readonly name: string
  /** File contents by name, so tests can seed or inspect what is "on disk". */
  readonly files = new Map<string, string>()
  readonly directories = new Map<string, FakeDirectoryHandle>()
  /** Simulates the user revoking folder access mid-session. */
  revoked = false

  constructor(name = 'root') {
    this.name = name
  }

  assertAccess(): void {
    if (this.revoked) throw new DOMException('Permission revoked', 'NotAllowedError')
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    this.assertAccess()
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound(name)
      this.files.set(name, '')
    }
    return new FakeFileHandle(this, name)
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    this.assertAccess()
    let directory = this.directories.get(name)
    if (!directory) {
      if (!options?.create) throw notFound(name)
      directory = new FakeDirectoryHandle(name)
      directory.revoked = this.revoked
      this.directories.set(name, directory)
    }
    return directory
  }

  /** Typed view for passing into code that expects the real browser interface. */
  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }
}
