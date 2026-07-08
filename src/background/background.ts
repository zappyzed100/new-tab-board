// background.ts — 最小サービスワーカー(拡張機能IDのE2E解決用・インストール時ログ)
import { logOp } from "../lib/log";

chrome.runtime.onInstalled.addListener(() => {
  logOp("background", "installed", "extension service worker started");
});
