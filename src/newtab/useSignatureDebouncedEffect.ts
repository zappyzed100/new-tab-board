// useSignatureDebouncedEffect.ts — 「値が実際に変わった時だけデバウンスして走らせる」effect
//
// 【なぜ専用のフックにするのか — 2026-07-20に踏んだ穴】
// 元はApp.tsxに直接こう書かれていた:
//
//   useEffect(() => {
//     const sig = notes.filter(...).map(n => n.id).join(",");
//     if (sig === lastRef.current) return;          // ← ここで抜けると
//     const timer = setTimeout(run, 5000);
//     return () => clearTimeout(timer);             // ← 直前のクリーンアップは既に走っている
//   }, [notes]);
//
// 依存が`notes`なので、本文の1文字入力やdriveFileId/lastSyncedAtの書き戻しのような
// **集合が変わらない更新**でもeffectが再実行される。その際クリーンアップが保留中のタイマーを
// 消したうえで、本体は「集合不変」と判断して早期returnし、**新しいタイマーを張らない**。
// 結果、デバウンス中の処理が音も無く消える。
//
// 同じ型の罠がコールバック側にもある——onFireをそのまま依存に入れると、親の再レンダーで
// 関数の同一性が変わるたびにタイマーが張り直され、更新が続く限り永久に発火しない。
// このフックは(1)依存を署名だけに絞り、(2)コールバックをrefで最新に保つことで、両方を
// 構造的に起こらなくする。呼び出し側は「何が変わったら走らせたいか」を署名として渡すだけでよい。
import { useEffect, useRef } from "react";

/** signatureが前回と異なる値になった時だけ、delayMs後にonFireを呼ぶ。
 * signatureがnullの間は何もしない(データ未ロード等)。delayMs中にsignatureが再び変われば
 * 待ち直す(通常のデバウンス)。アンマウント時は保留中の発火を取り消す。 */
export function useSignatureDebouncedEffect(
  signature: string | null,
  delayMs: number,
  onFire: (signature: string) => void,
): void {
  // 最新のコールバックを保持する。依存に入れないのが要点(ヘッダー参照)。
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    if (signature === null) return;
    const timer = setTimeout(() => onFireRef.current(signature), delayMs);
    return () => clearTimeout(timer);
  }, [signature, delayMs]);
}
