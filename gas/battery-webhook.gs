// battery-webhook.gs — スマホのバッテリー低下警告をNew Tab Boardへ中継するGoogle Apps Script。
// このリポジトリのビルド/テストの対象外(Googleのクラウドで動くコード)。
// 使い方は gas/README.md 参照。正本はこのファイル——script.google.comへコピー&ペーストする。
//
// 契約:
//   doPost: スマホ側の自動化アプリ(Tasker/ショートカット等)が、50/20/10%等の閾値を
//           下回った"瞬間"にだけ POST { "token": "<共有トークン>", "level": <0-100> } を送る
//           (充電時・閾値をまたがない時は何も送らない——ユーザーの実際の運用)。
//   doGet:  New Tab Board(拡張機能)が GET ?token=<共有トークン> で問い合わせる。
//           **読んだら即座に削除する(consume-on-read)**——doPostで保存された値は
//           一度doGetで読まれたら消え、次にdoPostが来るまでnullが返り続ける。
//           これにより「一度鳴らした閾値をいつ再武装するか」を拡張機能側で管理する必要が
//           無くなる(値がある=スマホが新たに閾値を下回った未処理イベント、という単純な
//           1回限りのメールボックスとして機能する。旧設計では「51%を超えて回復しないと
//           発火済み記録がリセットされない」ため、充電トリガーを送らない運用だと閾値が
//           生涯二度と鳴らなくなる欠陥があった——ユーザー指摘で2026-07-18に consume-on-read
//           方式へ変更)。
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
    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      var props = PropertiesService.getScriptProperties();
      props.setProperty("batteryLevel", String(level));
      props.setProperty("updatedAt", new Date().toISOString());
    } finally {
      lock.releaseLock();
    }
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// consume-on-read: 読んだ値は同じ実行内で即座に削除する(read+deleteをLockServiceで
// 1トランザクションにまとめ、doPostとの競合——読んでいる最中に新しいPOSTが来て
// 削除で巻き込む事故——を防ぐ)。
function doGet(e) {
  var token = e.parameter.token;
  if (token !== SHARED_TOKEN) {
    return jsonOutput({ ok: false, error: "invalid token" });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var level = props.getProperty("batteryLevel");
    var updatedAt = props.getProperty("updatedAt");
    if (level !== null) {
      props.deleteProperty("batteryLevel");
      props.deleteProperty("updatedAt");
    }
    return jsonOutput({
      ok: true,
      level: level === null ? null : Number(level),
      updatedAt: updatedAt || null,
    });
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
