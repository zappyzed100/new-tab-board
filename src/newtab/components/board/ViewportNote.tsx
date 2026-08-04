// ViewportNote.tsx — 500件ボードでも詳細ノートペインを表示領域周辺だけに制限する窓化ラッパ。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// 内側の窓化(Notepad.EDITOR_VIEWPORT_MARGIN_PX=900)より**狭く**する(2026-07-30)。
// 逆転すると「セルはマウント済みなのに中のCM6はdeferred」という帯ができ、そのペインが
// 最小高さまで潰れて、盤面が空けている場所との差が真っ黒な隙間として残る(Notepad.tsx参照)。
const VIEWPORT_MARGIN_PX = 640;
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
  /** assumedHeight: 呼び出し側(App)がこのノートの高さとして**現在レイアウトに使っている値**
   * (実測値が無ければ本文からの見積もり)。実測がこれより高いか同程度なら猶予を置かず
   * 即座に確定してよい——想定より高い実測を待つと、topは想定で積まれているのにセルは実測で
   * 描かれるため、その差ぶんの穴が列の中に開いたままになる(2026-07-29)。 */
  onHeight: (id: string, height: number, isFirstSinceMount: boolean, assumedHeight: number) => void;
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
  // 高さの実測は**内側のラッパ**で行う(セルではない)。セルには「盤面が確保した高さ」を
  // min-heightで持たせるため、セルを測ると min-height 自身を測り返して見積もりが永久に
  // 是正されない(自己成就する固定点になる)。ラッパは中身なりの高さなので測定は常に正直。
  const measureRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(active);
  const [placeholderHeight, setPlaceholderHeight] = useState(estimatedHeight);
  const contentVersionRef = useRef(contentVersion);
  const mountedVersionRef = useRef(contentVersion);
  const onSuspendRef = useRef(onSuspend);
  const estimatedHeightRef = useRef(estimatedHeight);
  estimatedHeightRef.current = estimatedHeight;
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
    const measured = measureRef.current;
    if (!mounted || !measured || typeof ResizeObserver === "undefined") return;
    let isFirst = true;
    const observer = new ResizeObserver((entries) => {
      // 中のCM6がまだ生成されていない(Notepadの内側の窓化がdeferred)ペインは最小高さまで
      // 潰れており、その値は「このノートの高さ」ではない。確定させると、盤面がそのノートの
      // ぶんだけ縮んで読んでいた位置が数百〜千px跳ね、CM6が生成された瞬間にまた戻る
      // (2026-07-30に実測: 1,031pxのジャンプ)。生成されるまで測らない——確保した場所は
      // セルのmin-heightが埋めているので、測らなくても穴は開かない。
      if (measured.querySelector('[data-editor-state="deferred"]')) return;
      for (const entry of entries) {
        onHeight(noteId, entry.contentRect.height, isFirst, estimatedHeightRef.current);
      }
      isFirst = false;
    });
    observer.observe(measured);
    return () => {
      observer.disconnect();
      onUnmountBeforeSettle?.(noteId);
    };
    // estimatedHeightは依存に入れずrefで読む——値が変わるたびObserverを張り直すと
    // isFirstSinceMountが毎回trueへ戻り、猶予判定が壊れるため。
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
      // minHeight は「盤面(App.tsxのnoteLayout)がこのノートのために空けた高さ」。中身が
      // それより低い状態(=CM6がまだ描かれず最小高さに潰れているペイン)でも、セルは確保ぶんを
      // 占め続ける——占めないと、次のセルまでの差が**実体のない隙間=真っ黒な領域**として残る
      // (2026-07-30に実測で特定: 高さ450pxのセルの下に9,526pxの空白。2026-07-29から残っていた
      // 「上スクロール中の真っ黒」の残り)。実測(ResizeObserver)は内側のラッパで取るので、
      // この確保が見積もりを固定してしまうことはない。
      style={
        {
          top: `${top}px`,
          minHeight: `${estimatedHeight}px`,
          "--note-column-index": columnIndex,
          ...(mounted ? null : { height: `${placeholderHeight}px` }),
        } as CSSProperties
      }
    >
      <div ref={measureRef} className="note-cell-measure">
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
    </div>
  );
}
