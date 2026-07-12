# native-host/ — NASブリッジ native messaging host

`window.showDirectoryPicker()`をChrome拡張機能のページから呼ぶと、実際に有効な
フォルダを選択してもAbortErrorになる既知のChromiumバグ
([WICG/file-system-access#314](https://github.com/WICG/file-system-access/issues/314)、
[crbug.com/issues/40240444](https://issues.chromium.org/issues/40240444))を回避するため、
PC側に常駐するこの小さなプログラムと標準入出力でJSON通信し、NASフォルダへの
読み書きを行う。契約は[`docs/nas-native-messaging-protocol.md`](../docs/nas-native-messaging-protocol.md)。

## 導入手順(Windows)

1. Python 3.11以降が入っていること(`python --version`で確認)。
2. このフォルダで以下を実行する:
   ```
   python install_windows.py
   ```
   `nas_bridge.bat`(起動用ラッパー)と`com.newtabboard.nas_bridge.json`(host
   マニフェスト)がこのフォルダに生成され、Windowsレジストリ
   (`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.newtabboard.nas_bridge`)
   へマニフェストの場所が登録される。
3. `chrome://extensions`で拡張機能を再読み込みする。
4. データ管理パネルの「NASフォルダを設定」でフォルダのパス(例:
   `Z:\NAS\backup`や`\\myserver\backup`)を入力して保存する。

## アンインストール

以下のレジストリキーを削除する:
```
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.newtabboard.nas_bridge
```
このフォルダの`nas_bridge.bat`・`com.newtabboard.nas_bridge.json`(いずれも
`install_windows.py`が生成した派生ファイル)も削除して構わない。

## テスト

```
cd native-host
uv run --with pytest pytest test_nas_bridge.py
```
