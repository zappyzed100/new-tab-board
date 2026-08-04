// shims.d.ts — 型定義を持たないパッケージのアンビエント宣言
declare module "markdown-it-task-lists";

// Viteがビルド時に埋め込む環境変数(.env.local。リポジトリには入れない)。
// VITE_GOOGLE_CLIENT_SECRET はDriveの更新トークン方式で使う——未設定なら
// 従来のimplicitフローへ自動で落ちる(src/lib/drive/googleAuth.ts参照)。
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
