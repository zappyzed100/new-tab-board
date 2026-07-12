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

## タグ検索用の索引 (build_index.py)

拡張機能が `<NASフォルダ>/notes/<id>.md`(YAML front matter + 本文)を書き出す。
これを外部ツールからSQLで検索したい場合は、次で `<NASフォルダ>/data/index.db`(SQLite)を
再生成する(正本は .md。db は消えても再生成できる):

```
python build_index.py "Z:\NAS\backup"
```

生成される `index.db` の主なテーブルは `notes / tags / note_tags`。例: 「開発」タグのノート:

```sql
SELECT notes.title FROM notes
JOIN note_tags ON notes.id = note_tags.note_id
JOIN tags ON tags.id = note_tags.tag_id
WHERE tags.name = '開発';
```

依存は標準ライブラリのみ(sqlite3)。拡張機能自身はこの db を読まない(ブラウザからSQLiteは
使えないため。アプリ内のタグ検索はメモリ内フィルタで完結する)。

## テスト

```
cd native-host
uv run --with pytest pytest
```
