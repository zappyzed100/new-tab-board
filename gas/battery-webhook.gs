// battery-webhook.gs — スマホのバッテリー低下警告をNew Tab Boardへ中継するGoogle Apps Script。
// このリポジトリのビルド/テストの対象外(Googleのクラウドで動くコード)。
// 使い方は gas/README.md 参照。正本はこのファイル——script.google.comへコピー&ペーストする。
//
// 契約:
//   doPost: スマホ側の自動化アプリ(Tasker/ショートカット等)が
//           POST { "token": "<共有トークン>", "level": <0-100> } を送る。
//   doGet:  New Tab Board(拡張機能)が
//           GET ?token=<共有トークン> で最新のバッテリー残量を取得する。
// 共有トークンは第三者による書き込み/読み取りを防ぐための簡易認証(URLが漏れても
// トークンを知らなければ操作できない——ユーザー指示で導入)。

// ここを自分だけの長いランダム文字列に書き換えてから使う(推測されにくいものにする)。
var SHARED_TOKEN = "REPLACE_WITH_YOUR_OWN_LONG_RANDOM_TOKEN";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) {
      return jsonOutput({ ok: false, error: "invalid token" });
    }
    var level = Number(body.level);
    if (!isFinite(level) || level < 0 || level > 100) {
      return jsonOutput({ ok: false, error: "invalid level" });
    }
    var props = PropertiesService.getScriptProperties();
    props.setProperty("batteryLevel", String(level));
    props.setProperty("updatedAt", new Date().toISOString());
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var token = e.parameter.token;
  if (token !== SHARED_TOKEN) {
    return jsonOutput({ ok: false, error: "invalid token" });
  }
  var props = PropertiesService.getScriptProperties();
  var level = props.getProperty("batteryLevel");
  var updatedAt = props.getProperty("updatedAt");
  return jsonOutput({
    ok: true,
    level: level === null ? null : Number(level),
    updatedAt: updatedAt || null,
  });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
