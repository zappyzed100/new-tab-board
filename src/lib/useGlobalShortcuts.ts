// useGlobalShortcuts.ts — shortcuts.tsのレジストリをwindowのkeydownへ配線するReact hook(SPEC.md §4.6)
//
// 修飾キー無しのコンボ(数字ジャンプ等)は、入力欄/contenteditable(エディタ)へ
// フォーカス中は発火させない(SPEC.md §6「エディタ非フォーカス時」)。
import { useEffect, useRef } from "react";
import { matchesCombo, type ShortcutDef } from "./shortcuts";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

export function useGlobalShortcuts(
  registry: ShortcutDef[],
  handlers: Record<string, () => void>,
): void {
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      for (const def of registryRef.current) {
        if (!def.combo.ctrlOrMeta && isEditableTarget(event.target)) continue;
        if (!matchesCombo(def.combo, event)) continue;
        const handler = handlersRef.current[def.id];
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
