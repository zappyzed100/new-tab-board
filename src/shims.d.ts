// shims.d.ts — 型定義を持たないパッケージ・APIのアンビエント宣言
declare module "markdown-it-task-lists";

// File System Access API: lib.dom.d.tsにハンドル型はあるが、Windowへの生やし忘れがあるため補う。
interface Window {
  showOpenFilePicker(options?: {
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

// File System Access APIの永続化権限(NAS二層アーカイブ・SPEC.md §4.3)。
// lib.dom.d.tsにFileSystemHandle自体はあるがPermission系メソッドが無いため補う。
type FileSystemPermissionMode = "read" | "readwrite";
type FileSystemPermissionState = "granted" | "denied" | "prompt";
interface FileSystemHandle {
  queryPermission(options?: {
    mode?: FileSystemPermissionMode;
  }): Promise<FileSystemPermissionState>;
  requestPermission(options?: {
    mode?: FileSystemPermissionMode;
  }): Promise<FileSystemPermissionState>;
}
