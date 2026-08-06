import { useEffect, useRef, useState, useCallback } from 'react';

export type PatternType = 'raw' | 'debounce' | 'throttle' | 'rateLimit' | 'queue' | 'batch';

export interface TimelineEvent {
  id: string;
  timestamp: number;
  pattern: PatternType;
  triggerTimestamp?: number;
}

interface CanvasTimelineProps {
  events: TimelineEvent[];
  windowMs?: number; 
  isPaused: boolean;
  pausedTimeRef: React.MutableRefObject<number | null>;
  totalPausedDurationRef: React.MutableRefObject<number>;
}

export interface HoveredDotInfo {
  event: TimelineEvent;
  cssX: number;
  cssY: number;
  laneLabel: string;
  laneColor: string;
}

const LANES: { id: PatternType; label: string; color: string }[] = [
  { id: 'raw', label: 'Raw Clicks', color: '#64748b' },       // slate-500
  { id: 'debounce', label: 'Debounce', color: '#3b82f6' },    // blue-500
  { id: 'throttle', label: 'Throttle', color: '#10b981' },    // emerald-500
  { id: 'rateLimit', label: 'Rate Limit', color: '#ef4444' }, // red-500
  { id: 'queue', label: 'Queue', color: '#f59e0b' },          // amber-500
  { id: 'batch', label: 'Batch', color: '#8b5cf6' },          // violet-500
];

function getPatternNote(pattern: PatternType): string {
  switch (pattern) {
    case 'raw':
      return 'Instant user click event. Serves as baseline for latency comparison.';
    case 'debounce':
      return 'Execution delayed until 500ms of quiet time passed after event burst.';
    case 'throttle':
      return 'Execution constrained to at most once per 500ms time window.';
    case 'rateLimit':
      return 'Execution checked against rate budget (max 3 calls per 2000ms window).';
    case 'queue':
      return 'Queued and executed sequentially with concurrency: 1 (400ms job time).';
    case 'batch':
      return 'Batched into grouped execution (maxSize: 5 items or 1000ms wait).';
  }
}

export function CanvasTimeline({ 
  events, 
  windowMs = 6000,
  isPaused,
  pausedTimeRef,
  totalPausedDurationRef
}: CanvasTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [hoveredDot, setHoveredDot] = useState<HoveredDotInfo | null>(null);

  // Keep events in a ref so the render loop always has fresh data without restarting
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Use a ref for isPaused to prevent closures from capturing stale values in the loop
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const hoveredDotRef = useRef(hoveredDot);
  hoveredDotRef.current = hoveredDot;

  // Clear hover state when unpausing
  useEffect(() => {
    if (!isPaused) {
      setHoveredDot(null);
    }
  }, [isPaused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    // Handle high-DPI (Retina) displays cleanly
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const laneHeight = rect.height / LANES.length;

    const renderLoop = () => {
      // Virtual time: when paused, now is frozen at the moment pause was pressed
      const now = isPausedRef.current
        ? (pausedTimeRef.current ?? Date.now()) - totalPausedDurationRef.current
        : Date.now() - totalPausedDurationRef.current;
      
      // CRITICAL: Wipe canvas clean every single frame to prevent text ghosting/smearing
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Draw the background lanes, dividers, and dynamic labels
      LANES.forEach((lane, index) => {
        const y = index * laneHeight;
        
        // Alternating row background shading
        ctx.fillStyle = index % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'transparent';
        ctx.fillRect(0, y, rect.width, laneHeight);

        // Count active events in this lane within the current window
        const count = eventsRef.current.filter((e) => e.pattern === lane.id).length;

        // Lane label with crisp font rendering
        ctx.fillStyle = '#a1a1aa'; // zinc-400
        ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${lane.label} (${count})`, 16, y + laneHeight / 2 + 4);
        
        // Lane divider line
        ctx.strokeStyle = '#27272a'; // zinc-800
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + laneHeight);
        ctx.lineTo(rect.width, y + laneHeight);
        ctx.stroke();
      });

      // Draw the "Present Time" marker line on the far right
      const presentX = rect.width - 30; 
      ctx.strokeStyle = '#52525b'; // zinc-600
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(presentX, 0);
      ctx.lineTo(presentX, rect.height);
      ctx.stroke();
      ctx.setLineDash([]); // Reset line dash

      // Draw event dots moving from right to left
      eventsRef.current.forEach((event) => {
        const age = now - event.timestamp;
        if (age < 0 || age > windowMs) return; // Ignore if off-screen

        const progress = age / windowMs;
        const x = presentX - (progress * (presentX - 50)); // Scale to fit nicely

        const laneIndex = LANES.findIndex((l) => l.id === event.pattern);
        if (laneIndex === -1) return;
        
        const lane = LANES[laneIndex];
        const y = laneIndex * laneHeight + (laneHeight / 2);

        const isHovered = isPausedRef.current && hoveredDotRef.current?.event.id === event.id;

        // Draw outer highlight pulse ring if hovered in paused mode
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Draw the glowing dot
        ctx.beginPath();
        ctx.arc(x, y, isHovered ? 7 : 6, 0, Math.PI * 2);
        ctx.fillStyle = lane.color;
        
        ctx.shadowColor = lane.color;
        ctx.shadowBlur = isHovered ? 14 : 8;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow
      });

      // Request next frame
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    // CRITICAL CLEANUP: Kills duplicate loops on React re-renders to prevent text smearing
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [windowMs, pausedTimeRef, totalPausedDurationRef]);

  // Handle canvas mouse movement for tooltip hit-testing in paused mode
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const now = (pausedTimeRef.current ?? Date.now()) - totalPausedDurationRef.current;
    const presentX = rect.width - 30;
    const laneHeight = rect.height / LANES.length;

    let closest: HoveredDotInfo | null = null;
    let minDistance = 14; // Hit test distance threshold in pixels

    eventsRef.current.forEach((event) => {
      const age = now - event.timestamp;
      if (age < 0 || age > windowMs) return;

      const progress = age / windowMs;
      const dotX = presentX - (progress * (presentX - 50));
      const laneIndex = LANES.findIndex((l) => l.id === event.pattern);
      if (laneIndex === -1) return;

      const lane = LANES[laneIndex];
      const dotY = laneIndex * laneHeight + (laneHeight / 2);

      const dist = Math.hypot(mouseX - dotX, mouseY - dotY);
      if (dist < minDistance) {
        minDistance = dist;
        closest = {
          event,
          cssX: dotX,
          cssY: dotY,
          laneLabel: lane.label,
          laneColor: lane.color,
        };
      }
    });

    setHoveredDot(closest);
  }, [isPaused, windowMs, pausedTimeRef, totalPausedDurationRef]);

  const handleMouseLeave = useCallback(() => {
    setHoveredDot(null);
  }, []);

  const currentNow = isPaused
    ? (pausedTimeRef.current ?? Date.now()) - totalPausedDurationRef.current
    : Date.now() - totalPausedDurationRef.current;

  return (
    <div className="w-full flex flex-col gap-0">
      {/* Paused badge — lives outside the canvas so it never overlaps dots */}
      <div
        className={`flex items-center justify-center gap-2 py-2 rounded-t-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
          isPaused
            ? 'bg-amber-600/90 text-white'
            : 'bg-zinc-900 text-zinc-600 border-b border-zinc-800'
        }`}
      >
        {isPaused ? (
          <>
            <span>⏸</span>
            <span>PAUSED — Hover on dots to inspect execution details</span>
          </>
        ) : (
          <span>● LIVE</span>
        )}
      </div>

      <div 
        ref={containerRef}
        className="relative w-full h-105 bg-zinc-950 border border-zinc-800 rounded-b-xl overflow-hidden shadow-2xl"
      >
        <canvas 
          ref={canvasRef} 
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={`w-full h-full block ${isPaused ? 'cursor-pointer' : 'cursor-default'}`}
        />

        {/* Floating Tooltip Card (Only in Paused Mode) */}
        {isPaused && hoveredDot && (
          <div 
            className="absolute z-30 pointer-events-none bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-xl p-3.5 text-xs text-white shadow-2xl transition-all duration-150 flex flex-col gap-2 min-w-[230px] max-w-[280px]"
            style={{ 
              left: `${Math.min(Math.max(hoveredDot.cssX, 120), (canvasRef.current?.getBoundingClientRect().width || 600) - 120)}px`,
              top: hoveredDot.cssY < 120 ? `${hoveredDot.cssY + 14}px` : `${hoveredDot.cssY - 14}px`,
              transform: hoveredDot.cssY < 120 ? 'translateX(-50%)' : 'translate(-50%, -100%)'
            }}
          >
            {/* Header with Pattern Color Badge */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span 
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-sm"
                  style={{ backgroundColor: hoveredDot.laneColor, boxShadow: `0 0 8px ${hoveredDot.laneColor}` }}
                />
                <span className="font-bold text-zinc-100 text-sm">{hoveredDot.laneLabel}</span>
              </div>
              <span className="font-mono text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                {hoveredDot.event.pattern}
              </span>
            </div>

            {/* Timing & Latency Metrics */}
            <div className="grid grid-cols-2 gap-2 text-zinc-300">
              <div className="bg-zinc-950/60 p-2 rounded border border-zinc-800/80">
                <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Time Ago</div>
                <div className="font-mono font-semibold text-teal-400 text-xs mt-0.5">
                  -{((currentNow - hoveredDot.event.timestamp) / 1000).toFixed(2)}s
                </div>
              </div>
              <div className="bg-zinc-950/60 p-2 rounded border border-zinc-800/80">
                <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Trigger Latency</div>
                <div className="font-mono font-semibold text-amber-400 text-xs mt-0.5">
                  {hoveredDot.event.pattern === 'raw' 
                    ? '0ms (Trigger)' 
                    : `+${Math.max(0, Math.round(hoveredDot.event.timestamp - (hoveredDot.event.triggerTimestamp ?? hoveredDot.event.timestamp)))}ms`
                  }
                </div>
              </div>
            </div>

            {/* Pattern Context Description */}
            <p className="text-[11px] text-zinc-400 leading-relaxed bg-zinc-950/40 p-2 rounded border border-zinc-800/50">
              {getPatternNote(hoveredDot.event.pattern)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}