import { useReducer, useEffect, useRef, useCallback, type ReactNode } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VB {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ViewState {
  vb: VB;
  initial: VB;
  dragging: boolean;
  dragStart: { sx: number; sy: number };
  dragVbStart: { x: number; y: number };
}

type ViewAction =
  | { type: "zoom"; cx: number; cy: number; factor: number; rect: DOMRect }
  | { type: "pan-start"; sx: number; sy: number }
  | { type: "pan-move"; sx: number; sy: number; rect: DOMRect }
  | { type: "pan-end" }
  | { type: "zoom-btn"; factor: number }
  | { type: "fit" }
  | { type: "set-vb"; vb: VB };

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.1; // max zoom-out: viewBox 10x initial
const MAX_ZOOM = 20; // max zoom-in: viewBox 1/20 initial
const WHEEL_FACTOR = 0.1;
const BTN_FACTOR = 0.3;
const ANIM_MS = 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampVB(vb: VB, initial: VB): VB {
  const minW = initial.w / MAX_ZOOM;
  const maxW = initial.w / MIN_ZOOM;
  const w = Math.max(minW, Math.min(maxW, vb.w));
  const ratio = initial.h / initial.w;
  const h = w * ratio;
  return { x: vb.x, y: vb.y, w, h };
}

function reducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "zoom": {
      const { cx, cy, factor, rect } = action;
      const { vb } = state;
      // Mouse position in SVG coords
      const svgX = vb.x + ((cx - rect.left) / rect.width) * vb.w;
      const svgY = vb.y + ((cy - rect.top) / rect.height) * vb.h;
      const newW = vb.w * factor;
      const newH = vb.h * factor;
      const raw: VB = {
        x: svgX - ((cx - rect.left) / rect.width) * newW,
        y: svgY - ((cy - rect.top) / rect.height) * newH,
        w: newW,
        h: newH,
      };
      return { ...state, vb: clampVB(raw, state.initial) };
    }
    case "pan-start":
      return {
        ...state,
        dragging: true,
        dragStart: { sx: action.sx, sy: action.sy },
        dragVbStart: { x: state.vb.x, y: state.vb.y },
      };
    case "pan-move": {
      if (!state.dragging) return state;
      const { sx, sy, rect } = action;
      const scale = state.vb.w / rect.width;
      return {
        ...state,
        vb: {
          ...state.vb,
          x: state.dragVbStart.x - (sx - state.dragStart.sx) * scale,
          y: state.dragVbStart.y - (sy - state.dragStart.sy) * scale,
        },
      };
    }
    case "pan-end":
      return { ...state, dragging: false };
    case "zoom-btn": {
      const { vb, initial } = state;
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newVB = clampVB({ x: vb.x, y: vb.y, w: vb.w * action.factor, h: vb.h * action.factor }, initial);
      newVB.x = cx - newVB.w / 2;
      newVB.y = cy - newVB.h / 2;
      return { ...state, vb: newVB };
    }
    case "fit":
      return { ...state, vb: { ...state.initial } };
    case "set-vb":
      return { ...state, vb: action.vb };
    default:
      return state;
  }
}

// ─── Animated viewBox transition ─────────────────────────────────────────────

function useAnimatedDispatch(dispatch: React.Dispatch<ViewAction>, stateRef: React.RefObject<ViewState>) {
  const rafId = useRef(0);

  return useCallback(
    (action: ViewAction) => {
      // For zoom-btn and fit, animate; otherwise dispatch directly
      if (action.type !== "zoom-btn" && action.type !== "fit") {
        dispatch(action);
        return;
      }
      // Compute target
      const from = stateRef.current!.vb;
      const tmpState = reducer(stateRef.current!, action);
      const to = tmpState.vb;
      const start = performance.now();
      cancelAnimationFrame(rafId.current);
      function tick(now: number) {
        const t = Math.min((now - start) / ANIM_MS, 1);
        const ease = t * (2 - t); // ease-out quadratic
        dispatch({
          type: "set-vb",
          vb: {
            x: from.x + (to.x - from.x) * ease,
            y: from.y + (to.y - from.y) * ease,
            w: from.w + (to.w - from.w) * ease,
            h: from.h + (to.h - from.h) * ease,
          },
        });
        if (t < 1) rafId.current = requestAnimationFrame(tick);
      }
      rafId.current = requestAnimationFrame(tick);
    },
    [dispatch, stateRef],
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface LegendItem {
  label: string;
  fill: string;
  stroke: string;
  /** If true, render as a border-only chip (for input/output indicators) */
  borderOnly?: boolean;
}

interface GraphViewerProps {
  svgContent: ReactNode;
  initialViewBox: { x: number; y: number; width: number; height: number };
  legend?: LegendItem[];
  onClose: () => void;
}

export default function GraphViewer({ svgContent, initialViewBox, legend, onClose }: GraphViewerProps) {
  const initial: VB = { x: initialViewBox.x, y: initialViewBox.y, w: initialViewBox.width, h: initialViewBox.height };

  const [state, rawDispatch] = useReducer(reducer, {
    vb: { ...initial },
    initial,
    dragging: false,
    dragStart: { sx: 0, sy: 0 },
    dragVbStart: { x: 0, y: 0 },
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useAnimatedDispatch(rawDispatch, stateRef);

  const svgRef = useRef<SVGSVGElement>(null);
  const pendingWheel = useRef<{ cx: number; cy: number; delta: number } | null>(null);
  const wheelRaf = useRef(0);

  // Pinch state
  const lastPinchDist = useRef(0);

  // ── Wheel zoom (rAF-gated) ──
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      pendingWheel.current = { cx: e.clientX, cy: e.clientY, delta: e.deltaY };
      if (!wheelRaf.current) {
        wheelRaf.current = requestAnimationFrame(() => {
          wheelRaf.current = 0;
          const pw = pendingWheel.current;
          if (!pw || !svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const factor = pw.delta > 0 ? 1 + WHEEL_FACTOR : 1 - WHEEL_FACTOR;
          rawDispatch({ type: "zoom", cx: pw.cx, cy: pw.cy, factor, rect });
          pendingWheel.current = null;
        });
      }
    },
    [],
  );

  // Attach native wheel listener with { passive: false }
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      pendingWheel.current = { cx: e.clientX, cy: e.clientY, delta: e.deltaY };
      if (!wheelRaf.current) {
        wheelRaf.current = requestAnimationFrame(() => {
          wheelRaf.current = 0;
          const pw = pendingWheel.current;
          if (!pw) return;
          const rect = svg.getBoundingClientRect();
          const factor = pw.delta > 0 ? 1 + WHEEL_FACTOR : 1 - WHEEL_FACTOR;
          rawDispatch({ type: "zoom", cx: pw.cx, cy: pw.cy, factor, rect });
          pendingWheel.current = null;
        });
      }
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  // ── Mouse pan ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    rawDispatch({ type: "pan-start", sx: e.clientX, sy: e.clientY });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!stateRef.current.dragging || !svgRef.current) return;
      rawDispatch({ type: "pan-move", sx: e.clientX, sy: e.clientY, rect: svgRef.current.getBoundingClientRect() });
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    rawDispatch({ type: "pan-end" });
  }, []);

  // ── Touch pan & pinch ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      rawDispatch({ type: "pan-start", sx: e.touches[0].clientX, sy: e.touches[0].clientY });
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && stateRef.current.dragging && svgRef.current) {
        rawDispatch({ type: "pan-move", sx: e.touches[0].clientX, sy: e.touches[0].clientY, rect: svgRef.current.getBoundingClientRect() });
      } else if (e.touches.length === 2 && svgRef.current) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastPinchDist.current > 0) {
          const factor = lastPinchDist.current / dist;
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const rect = svgRef.current.getBoundingClientRect();
          rawDispatch({ type: "zoom", cx: midX, cy: midY, factor, rect });
        }
        lastPinchDist.current = dist;
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    rawDispatch({ type: "pan-end" });
    lastPinchDist.current = 0;
  }, []);

  // ── Keyboard ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "+":
        case "=":
          dispatch({ type: "zoom-btn", factor: 1 - BTN_FACTOR });
          break;
        case "-":
          dispatch({ type: "zoom-btn", factor: 1 + BTN_FACTOR });
          break;
        case "0":
        case "Home":
          dispatch({ type: "fit" });
          break;
        case "ArrowLeft":
          rawDispatch({ type: "set-vb", vb: { ...stateRef.current.vb, x: stateRef.current.vb.x - stateRef.current.vb.w * 0.1 } });
          break;
        case "ArrowRight":
          rawDispatch({ type: "set-vb", vb: { ...stateRef.current.vb, x: stateRef.current.vb.x + stateRef.current.vb.w * 0.1 } });
          break;
        case "ArrowUp":
          rawDispatch({ type: "set-vb", vb: { ...stateRef.current.vb, y: stateRef.current.vb.y - stateRef.current.vb.h * 0.1 } });
          break;
        case "ArrowDown":
          rawDispatch({ type: "set-vb", vb: { ...stateRef.current.vb, y: stateRef.current.vb.y + stateRef.current.vb.h * 0.1 } });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dispatch]);

  // ── Derived ──
  const { vb } = state;
  const zoomPct = Math.round((initial.w / vb.w) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-black/80">
      {/* SVG canvas */}
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full h-full select-none"
        style={{
          background: "#faf8f4",
          cursor: state.dragging ? "grabbing" : "grab",
          willChange: "viewBox",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {svgContent}
      </svg>

      {/* Toolbar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[51] flex items-center gap-1 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5">
        <ToolBtn title="Zoom out (-)" onClick={() => dispatch({ type: "zoom-btn", factor: 1 + BTN_FACTOR })}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" /></svg>
        </ToolBtn>

        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[3rem] text-center tabular-nums select-none">
          {zoomPct}%
        </span>

        <ToolBtn title="Zoom in (+)" onClick={() => dispatch({ type: "zoom-btn", factor: 1 - BTN_FACTOR })}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
        </ToolBtn>

        <ToolBtn title="Zoom to fit (0)" onClick={() => dispatch({ type: "fit" })}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M3.75 3A.75.75 0 003 3.75v2.5a.75.75 0 001.5 0V4.5h1.75a.75.75 0 000-1.5h-2.5zM13.75 3a.75.75 0 000 1.5h1.75v1.75a.75.75 0 001.5 0v-2.5a.75.75 0 00-.75-.75h-2.5zM3 13.75a.75.75 0 011.5 0v1.75h1.75a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75v-2.5zM16.5 13.75a.75.75 0 00-1.5 0v1.75h-1.75a.75.75 0 000 1.5h2.5a.75.75 0 00.75-.75v-2.5z" />
          </svg>
        </ToolBtn>

        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

        <ToolBtn title="Close (Esc)" onClick={onClose}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
        </ToolBtn>
      </div>

      {/* Legend */}
      {legend && legend.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[51] flex flex-wrap justify-center gap-x-3 gap-y-1 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 max-w-[90vw]">
          {legend.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0"
                style={
                  item.borderOnly
                    ? { border: `2px solid ${item.stroke}` }
                    : { background: item.fill, border: `1px solid ${item.stroke}` }
                }
              />
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* Keyboard hint (fades out) */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[51] text-xs text-white/60 select-none pointer-events-none animate-fade-hint">
        Scroll to zoom &middot; Drag to pan &middot; Press 0 to fit
      </div>
    </div>
  );
}

// ─── Toolbar button ──────────────────────────────────────────────────────────

function ToolBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-8 h-8 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition-colors text-gray-700 dark:text-gray-300"
    >
      {children}
    </button>
  );
}
