// lib.dom.d.ts が未収録の File System Access API を補う宣言。
// どれも一部のブラウザ（Chromium 系）にしか存在しないため、省略可能なメンバーとして宣言する。

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string | string[]>
}

interface OpenFilePickerOptions {
  multiple?: boolean
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface Window {
  showDirectoryPicker?(options?: FileSystemPermissionDescriptor): Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
}
