// ViewportNote.tsx — 500件ボードでも詳細ノートペインを表示領域周辺だけに制限する窓化ラッパ。
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  active: boolean;
  estimatedHeight?: number;
  contentVersion?: number;
  onHeight: (id: string, height: number) => void;
  onSuspend?: () => void;
  children: ReactNode;
};

export function ViewportNote({
  noteId,
  title,
  linearIndex,
  active,
  estimatedHeight = DEFAULT_PLACEHOLDER_HEIGHT_PX,
  contentVersion,
  onHeight,
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
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) onHeight(noteId, entry.contentRect.height);
    });
    observer.observe(cell);
    return () => observer.disconnect();
  }, [mounted, noteId, onHeight]);

  return (
    <div
      ref={cellRef}
      className="note-cell"
      data-linear-index={linearIndex}
      data-note-id={noteId}
      data-viewport-state={mounted ? "mounted" : "deferred"}
      style={mounted ? undefined : { height: `${placeholderHeight}px` }}
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
