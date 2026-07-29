// ViewportNote.tsx — 500件ボードでも詳細ノートペインを表示領域周辺だけに制限する窓化ラッパ。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const VIEWPORT_MARGIN_PX = 900;
const DEFAULT_PLACEHOLDER_HEIGHT_PX = 520;

type VisibilityListener = (visible: boolean) => void;
const visibilityListeners = new Map<Element, VisibilityListener>();
let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
  sharedObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        visibilityListeners.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { rootMargin: `${VIEWPORT_MARGIN_PX}px 0px` },
  );
  return sharedObserver;
}

function observeVisibility(element: Element, listener: VisibilityListener): () => void {
  visibilityListeners.set(element, listener);
  getSharedObserver().observe(element);
  return () => {
    sharedObserver?.unobserve(element);
    visibilityListeners.delete(element);
    if (visibilityListeners.size === 0) {
      sharedObserver?.disconnect();
      sharedObserver = null;
    }
  };
}

type Props = {
  noteId: string;
  title: string;
  linearIndex: number;
  /** 実測masonryで割り当てられた列(0始まり)。CSS変数 --note-column-index として左位置に効く。 */
  columnIndex: number;
  /** 列内の縦位置(px)。絶対配置なのでApp側の計算結果をそのまま座標として使う。 */
  top: number;
  active: boolean;
  estimatedHeight?: number;
  contentVersion?: number;
  /** isFirstSinceMount: このResizeObserverインスタンスが(再)生成されてから最初の報告ならtrue。
   * 窓化で一度アンマウントされたノートが再び画面へ近づいてマウントし直された直後は、CodeMirrorの
   * 内部レイアウトが数フレームで落ち着くまで実際と異なる高さを報告することがある——呼び出し側
   * (App.tsx)はこのフラグを使って、その一時的な報告だけ確定を遅らせ、既にマウント済みのノートの
   * 折り返し切替等による本物の高さ変化(2回目以降の報告)は即座に反映する。 */
  onHeight: (id: string, height: number, isFirstSinceMount: boolean) => void;
  /** 再マウント直後の高さ確定猶予(App.tsx側のsetTimeout)が発火する前にこのノートが画面外へ
   * アンマウントされた時に呼ぶ。呼び出し側は保留中の猶予タイマーを未確定のまま破棄する
   * (=移動中の一瞬だけの不正確な測定値をnoteHeightsへ確定させない)。 */
  onUnmountBeforeSettle?: (id: string) => void;
  onSuspend?: () => void;
  children: ReactNode;
};

export function ViewportNote({
  noteId,
  title,
  linearIndex,
  columnIndex,
  top,
  active,
  estimatedHeight = DEFAULT_PLACEHOLDER_HEIGHT_PX,
  contentVersion,
  onHeight,
  onUnmountBeforeSettle,
  onSuspend,
  children,
}: Props) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(active);
  const [placeholderHeight, setPlaceholderHeight] = useState(estimatedHeight);
  const contentVersionRef = useRef(contentVersion);
  const mountedVersionRef = useRef(contentVersion);
  const onSuspendRef = useRef(onSuspend);
  const mounted = active || nearViewport;
  contentVersionRef.current = contentVersion;
  onSuspendRef.current = onSuspend;

  useEffect(() => {
    const cell = cellRef.current;
    if (!cell || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    return observeVisibility(cell, (visible) => {
      if (!visible) {
        setPlaceholderHeight(Math.max(DEFAULT_PLACEHOLDER_HEIGHT_PX, cell.offsetHeight));
        if (contentVersionRef.current !== mountedVersionRef.current) onSuspendRef.current?.();
      } else {
        mountedVersionRef.current = contentVersionRef.current;
      }
      setNearViewport(visible);
    });
  }, []);

  useEffect(() => {
    if (!mounted) setPlaceholderHeight(estimatedHeight);
  }, [estimatedHeight, mounted]);

  // ResizeObserverは詳細ペインが存在する時だけ生成する。500個のプレースホルダには共有の
  // IntersectionObserver 1個だけが付き、ResizeObserverや子コンポーネントのtimerは付かない。
  useEffect(() => {
    const cell = cellRef.current;
    if (!mounted || !cell || typeof ResizeObserver === "undefined") return;
    let isFirst = true;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) onHeight(noteId, entry.contentRect.height, isFirst);
      isFirst = false;
    });
    observer.observe(cell);
    return () => {
      observer.disconnect();
      onUnmountBeforeSettle?.(noteId);
    };
  }, [mounted, noteId, onHeight, onUnmountBeforeSettle]);

  return (
    <div
      ref={cellRef}
      className="note-cell"
      data-linear-index={linearIndex}
      data-column-index={columnIndex}
      data-note-id={noteId}
      data-viewport-state={mounted ? "mounted" : "deferred"}
      // 絶対配置(layout.css)。列はCSS変数→left、縦はtopのpx。DOMの並びは常にorder順で不変なので、
      // 配置が変わってもReactは再マウントせず、編集中のCodeMirrorとフォーカスが生き残る。
      style={
        {
          top: `${top}px`,
          "--note-column-index": columnIndex,
          ...(mounted ? null : { height: `${placeholderHeight}px` }),
        } as CSSProperties
      }
    >
      {mounted ? (
        children
      ) : (
        <div
          className="note-pane-placeholder"
          data-testid={`note-placeholder-${noteId}`}
          aria-hidden="true"
        >
          {title}
        </div>
      )}
    </div>
  );
}
