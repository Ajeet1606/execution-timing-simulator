import { useEffect, useRef } from 'react';

export type PatternType = 'raw' | 'debounce' | 'throttle' | 'rateLimit' | 'queue' | 'batch';

export interface TimelineEvent {
  id: string;
  timestamp: number;
  pattern: PatternType;
}

interface CanvasTimelineProps {
  events: TimelineEvent[];
  windowMs?: number; 
  isPaused: boolean;
  pausedTimeRef: React.MutableRefObject<number | null>;
  totalPausedDurationRef: React.MutableRefObject<number>;
}

const LANES: { id: PatternType; label: string; color: string }[] = [
  { id: 'raw', label: 'Raw Clicks', color: '#64748b' },       // slate-500
  { id: 'debounce', label: 'Debounce', color: '#3b82f6' },    // blue-500
  { id: 'throttle', label: 'Throttle', color: '#10b981' },    // emerald-500
  { id: 'rateLimit', label: 'Rate Limit', color: '#ef4444' }, // red-500
  { id: 'queue', label: 'Queue', color: '#f59e0b' },          // amber-500
  { id: 'batch', label: 'Batch', color: '#8b5cf6' },          // violet-500
];

export function CanvasTimeline({ 
  events, 
  windowMs = 6000,
  isPaused,
  pausedTimeRef,
  totalPausedDurationRef
}: CanvasTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Keep events in a ref so the render loop always has fresh data without restarting
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Use a ref for isPaused to prevent closures from capturing stale values in the loop
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

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

        // Draw the glowing dot
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = lane.color;
        
        ctx.shadowColor = lane.color;
        ctx.shadowBlur = 8;
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
  }, [windowMs, pausedTimeRef, totalPausedDurationRef]); // Re-bind only if time window changes

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
            <span>PAUSED — inspecting snapshot</span>
          </>
        ) : (
          <span>● LIVE</span>
        )}
      </div>
      <div className="w-full h-105 bg-zinc-950 border border-zinc-800 rounded-b-xl overflow-hidden shadow-2xl">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full block"
        />
      </div>
    </div>
  );
}