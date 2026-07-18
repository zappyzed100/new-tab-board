# e2e/stress/ — フォルダ固有の知見

長時間待って「問題が出なかった」を合否条件にしない。実データ上限相当の500ノートを固定fixtureとして
投入し、詳細ペイン・CodeMirror・timer・Observer・DOMの数を明示した予算以下に保つ。さらに上下往復と
新規タブ生成/破棄を短時間へ圧縮し、GPUプロセスのハングや資源の無制限増加を通常のE2E失敗へ変換する。

Linux/XvfbではChrome起動時のnew-tab overrideがfixtureの初期清掃より遅れて現れ、空stateで負荷fixtureを
上書きしうる。`e2e/fixtures.ts`は初期Appによる空ノート3件の保存完了をstorage上で確認してからblank化
する。待ち時間を延ばすのではなく、競合する非同期書き込みが完了したという状態を開始条件にする。
