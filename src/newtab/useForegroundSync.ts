// useForegroundSync.ts — タブが前景に戻った時に同期を1回キックするReact hook
//
// 新しいタブを開いた直後の同期はApp側の初回effectが担う。こちらは**開きっぱなしのタブへ
// 戻ってきた時**を拾う(ユーザー指示・2026-07-20: タブ新規作成時・タブ操作時にDriveから
// activeを取得したい)。5分tickを待たずに他端末の変更が見えるようにするのが狙い。
//
// visibilitychange(タブ切り替え)とfocus(ウィンドウ切り替え)の両方を見る——片方だけだと、
// 別ウィンドウから戻った/別タブから戻ったのどちらかを取りこぼす。両方が同時に発火する
// 経路もあるため、最小間隔でまとめて1回に落とす(Drive APIを連打しないため)。
//
// コールバックはrefで最新に保つ: 依存に入れると親の再レンダーのたびにリスナーを張り直す
// (このリポジトリで繰り返し踏んでいるeffect依存の罠 — useSignatureDebouncedEffect.tsのヘッダー参照)。
import { useEffect, useRef } from "react";

/** 前景復帰でonForegroundを呼ぶ。直前の呼び出しからminIntervalMs未満なら見送る。
 * nowは時刻のシーム(src/lib/runtime/clock.ts)を呼び出し側から注入する——テストで固定するため。 */
export function useForegroundSync(
  onForeground: () => void,
  minIntervalMs: number,
  now: () => number,
): void {
  const onForegroundRef = useRef(onForeground);
  onForegroundRef.current = onForeground;
  const nowRef = useRef(now);
  nowRef.current = now;
  const lastFiredAtRef = useRef<number | null>(null);

  useEffect(() => {
    // マウント時刻を「直前に発火した」とみなす。新しいタブでは開いた直後にApp側の初回同期が
    // 走り、ほぼ同時にfocusも飛ぶため、そのままだと1タブ開くたびにDriveを二度叩く
    // (新しいタブページなので開く頻度が高く、無視できない)。初回同期の取りこぼしにはならない
    // ——マウント直後の分は初回effectが担当している。
    lastFiredAtRef.current = nowRef.current();
    function fire() {
      // visibilityState未定義の環境(jsdomの一部設定等)では「見えている」とみなす。
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const t = nowRef.current();
      if (lastFiredAtRef.current !== null && t - lastFiredAtRef.current < minIntervalMs) return;
      lastFiredAtRef.current = t;
      onForegroundRef.current();
    }
    document.addEventListener("visibilitychange", fire);
    window.addEventListener("focus", fire);
    return () => {
      document.removeEventListener("visibilitychange", fire);
      window.removeEventListener("focus", fire);
    };
  }, [minIntervalMs]);
}
