# install_windows.py — NASブリッジnative messaging hostをWindowsへ登録する
#
# レジストリ(HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\...)へ
# マニフェストファイルの場所を書き込む。実行後、Chromeで拡張機能を再読み込みすれば
# com.newtabboard.nas_bridgeへ接続できるようになる(契約: ../docs/nas-native-messaging-protocol.md)。
from __future__ import annotations

import json
import sys
from pathlib import Path

HOST_NAME = "com.newtabboard.nas_bridge"
# manifest.jsonのkeyから決定的に算出される固定の拡張機能ID(README.md参照)。
EXTENSION_ID = "gimpafmoklcgklcggonojldigofjbnnj"


def main() -> None:
    if sys.platform != "win32":
        print("このスクリプトはWindows専用です。", file=sys.stderr)
        sys.exit(1)

    import winreg  # Windows専用モジュールのためここでimportする(他OSでの読み込み時エラー回避)。

    here = Path(__file__).resolve().parent
    launcher = here / "nas_bridge.bat"
    manifest_path = here / f"{HOST_NAME}.json"

    launcher.write_text(
        f'@echo off\r\n"{sys.executable}" "{here / "nas_bridge.py"}"\r\n',
        encoding="utf-8",
    )

    manifest = {
        "name": HOST_NAME,
        "description": "New Tab Board NAS bridge",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXTENSION_ID}/"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    key_path = f"Software\\Google\\Chrome\\NativeMessagingHosts\\{HOST_NAME}"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
        winreg.SetValue(key, "", winreg.REG_SZ, str(manifest_path))

    print(f"登録しました: {manifest_path}")
    print("Chromeで拡張機能を再読み込みしてください。")


if __name__ == "__main__":
    main()
