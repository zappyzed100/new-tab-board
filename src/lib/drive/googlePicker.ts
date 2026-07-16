// googlePicker.ts — Google Picker APIで、drive.fileスコープのままユーザーに既存のDriveフォルダを
// 明示的に選ばせ、そのフォルダへのアクセス権をこのアプリへ付与してもらう(ユーザー指示:
// 複数アプリでapp/フォルダを共有したいが、drive.fileスコープのままではアプリが作っていない
// 既存フォルダを検索・アクセスできない——スコープを広げる代わりにPickerで解決する)。
import { logOp } from "../runtime/log";

const PICKER_SCRIPT_URL = "https://apis.google.com/js/api.js";

// google.picker / gapi のグローバル型は最小限だけ自前定義する(@types/google.picker等は未導入)。
type PickerDoc = { id: string; name: string };
type PickerCallbackData = { action: string; docs?: PickerDoc[] };
type PickerInstance = { setVisible: (visible: boolean) => void };
type PickerBuilder = {
  addView: (view: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder;
  build: () => PickerInstance;
};
type DocsView = {
  setIncludeFolders: (v: boolean) => DocsView;
  setSelectFolderEnabled: (v: boolean) => DocsView;
  setMimeTypes: (v: string) => DocsView;
};
type GooglePickerNamespace = {
  DocsView: new () => DocsView;
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
};
type GapiGlobal = { load: (api: "picker", cb: () => void) => void };

declare global {
  interface Window {
    gapi?: GapiGlobal;
    google?: { picker: GooglePickerNamespace };
  }
}

export type PickerDeps = {
  loadScript?: (src: string) => Promise<void>;
  getGapi?: () => GapiGlobal | undefined;
  getGooglePicker?: () => GooglePickerNamespace | undefined;
};

function defaultLoadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`スクリプト読み込み失敗: ${src}`));
    document.head.appendChild(script);
  });
}

/** gapi picker モジュールを読み込む(未読込なら<script>を挿入してgapi.load('picker')する)。 */
async function ensurePickerLoaded(deps: PickerDeps): Promise<GooglePickerNamespace> {
  const _loadScript = deps.loadScript ?? defaultLoadScript;
  const _getGapi = deps.getGapi ?? (() => window.gapi);
  const _getGooglePicker = deps.getGooglePicker ?? (() => window.google?.picker);

  const existing = _getGooglePicker();
  if (existing) return existing;

  if (!_getGapi()) {
    await _loadScript(PICKER_SCRIPT_URL);
  }
  const gapi = _getGapi();
  if (!gapi) throw new Error("gapiの読み込みに失敗しました");

  await new Promise<void>((resolve) => gapi.load("picker", () => resolve()));
  const picker = _getGooglePicker();
  if (!picker) throw new Error("Google Pickerの読み込みに失敗しました");
  return picker;
}

/** フォルダ選択用のGoogle Pickerを開き、ユーザーが選んだフォルダの{id, name}を返す
 * (キャンセル時はnull)。drive.fileスコープのトークンでも、Picker経由で選んだフォルダには
 * 以後アクセスできるようになる(Google公式の想定用途——スコープを広げずに既存フォルダへの
 * アクセスを得る唯一の方法)。 */
export async function pickSharedFolder(
  token: string,
  apiKey: string,
  deps: PickerDeps = {},
): Promise<PickerDoc | null> {
  logOp("googlePicker", "pick-start", "");
  const picker = await ensurePickerLoaded(deps);
  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");
      const instance = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setCallback((data: PickerCallbackData) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0];
            logOp("googlePicker", "pick-done", `id=${doc?.id ?? "none"}`);
            resolve(doc ? { id: doc.id, name: doc.name } : null);
          } else if (data.action === picker.Action.CANCEL) {
            logOp("googlePicker", "pick-cancel", "");
            resolve(null);
          }
        })
        .build();
      instance.setVisible(true);
    } catch (err) {
      logOp("googlePicker", "pick-error", "", { error: err });
      reject(err);
    }
  });
}
