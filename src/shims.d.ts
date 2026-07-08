// shims.d.ts — 型定義を持たないパッケージ・APIのアンビエント宣言
declare module "markdown-it-task-lists";

// File System Access API: lib.dom.d.tsにハンドル型はあるが、Windowへの生やし忘れがあるため補う。
interface Window {
  showOpenFilePicker(options?: {
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}
