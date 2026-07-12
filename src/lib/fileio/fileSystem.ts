// fileSystem.ts — ローカルファイルの読み込みの唯一の入出口(SPEC.md §4.10-a)
//
// ローカル.txtを「アプリ内で開く」(OSデフォルトハンドラにはなれない。§4.10前提)。
//
// 元々File System Access API(showOpenFilePicker)を使っていたが、Chrome拡張機能の
// ページ(chrome_url_overridesのnewtab等)から呼ぶと「ユーザーが実際にファイルを
// 選択してもAbortErrorで即座に失敗する」というChromium側の既知バグがある
// (WICG/file-system-access#314、crbug.com/issues/40240444。extensionコンテキスト特有)。
// 実機で「ボタンを押しても何も起きない」という形で再現したため、標準の
// `<input type="file">`へ置き換え、この既知バグの影響を受けない実装にしている。
//
// 「フォルダへ書き出し」(showDirectoryPickerで選んだフォルダへ全ノートを書き出す)は
// 同じ既知バグの影響が実機で解消できず(選択後にエラーメッセージすら出ない=無反応の
// ままだった)、ユーザー指示によりボタンごと撤去した。持続的な書き込み権限が要る
// NAS二層アーカイブ(nasArchive.ts)は同じshowDirectoryPickerを使い続けている——
// あちらは既知バグに当たった場合の案内メッセージを表示する形で運用している
// (DataPanel.tsxのhandleSetNasFolder)。
import { logOp } from "../runtime/log";

/** ファイル選択ダイアログ(OSのExplorer/Finder相当)で.txtを選び、中身を読み込む。
 * キャンセル時はnullを返す。 */
export async function pickAndReadTextFile(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    // 画面には出さないが、DOMに接続されていない要素へのclick()はネイティブの
    // ファイル選択ダイアログを開かないブラウザ/コンテキストがあるため、
    // 一時的にbodyへ挿入してから呼ぶ(処理後は必ず取り除く)。
    input.style.display = "none";
    document.body.appendChild(input);
    function cleanup() {
      input.remove();
    }
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    input.addEventListener("change", () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(
        (content) => {
          logOp("fileSystem", "open", `name=${file.name}`);
          resolve({ name: file.name, content });
        },
        (err: unknown) => {
          logOp("fileSystem", "open-error", String(err));
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
    input.click();
  });
}
