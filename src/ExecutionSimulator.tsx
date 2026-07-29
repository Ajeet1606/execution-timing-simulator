import { useState, useCallback, useRef } from 'react';
import { 
  useDebouncedCallback, 
  useThrottledCallback, 
  useRateLimitedCallback,
  useAsyncQueuer, 
  useBatcher 
} from '@tanstack/react-pacer';
import { Button } from '@/components/ui/button';
import { Play, Pause } from 'lucide-react';
import { CanvasTimeline, TimelineEvent, PatternType } from './CanvasTimeline';

export function ExecutionSimulator() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [windowMs, setWindowMs] = useState(6000);
  const [isPaused, setIsPaused] = useState(false);

  // Refs for tracking pause duration offsets
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const pausedTimeRef = useRef<number | null>(null);
  const totalPausedDurationRef = useRef<number>(0);

  // Compute virtual time: frozen at pausedTimeRef snapshot when paused
  const getVirtualNow = useCallback(() => {
    if (isPausedRef.current) {
      return (pausedTimeRef.current ?? Date.now()) - totalPausedDurationRef.current;
    }
    return Date.now() - totalPausedDurationRef.current;
  }, []);

  // Helper to push new dots to our visualizer
  const logEvent = useCallback((pattern: PatternType) => {
    setEvents((prev) => [
      ...prev, 
      { id: Math.random().toString(36).substring(2, 9), timestamp: getVirtualNow(), pattern }
    ]);
  }, [getVirtualNow]);

  // 1. Debounce
  const handleDebounce = useDebouncedCallback(
    useCallback(() => logEvent('debounce'), [logEvent]), 
    { wait: 500 }
  );

  // 2. Throttle
  const handleThrottle = useThrottledCallback(
    useCallback(() => logEvent('throttle'), [logEvent]), 
    { wait: 500 }
  );

  // 3. Rate Limit
  const handleRateLimit = useRateLimitedCallback(
    useCallback(() => logEvent('rateLimit'), [logEvent]), 
    { limit: 3, window: 2000 }
  );

  // 4. Queue
  const processQueue = useCallback(async (taskId: string) => {
    console.log(taskId)
    logEvent('queue');
    await new Promise(resolve => setTimeout(resolve, 400)); 
  }, [logEvent]);
  
  const handleQueue = useAsyncQueuer(processQueue, { concurrency: 1, started: true });

  // 5. Batch
  const processBatch = useCallback(async () => {
    logEvent('batch');
  }, [logEvent]);

  const handleBatch = useBatcher(processBatch, { maxSize: 5, wait: 1000, started: true });

  // The Master Trigger
 // The Master Trigger
  const triggerAll = () => {
    logEvent('raw');

    // Create a guaranteed string ID that works on HTTP localhost
    const safeId = Math.random().toString(36).substring(2, 9);

    handleDebounce();
    handleThrottle();
    handleRateLimit();
    
    // Fix: Force the queue engine to wake up before adding the item
    if (handleQueue.start) handleQueue.start();

    // Fix: Use the correct class method to push items into memory
    handleQueue.addItem(safeId); 
    handleBatch.addItem(safeId); 
  };

  return (
    <div className="max-w-5xl mx-auto p-8 bg-zinc-950 text-white min-h-screen flex flex-col justify-between">
      <div className="flex-grow">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Execution Timing Simulator</h1>
          <p className="text-zinc-400">
            Click rapidly to see how different architectural patterns handle high-frequency events.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Controls Panel */}
          <div className="md:col-span-1 space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl shadow-lg">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">
                Controls
              </h2>
              
              <Button 
                onClick={triggerAll}
                className="cursor-pointer w-full h-16 text-lg font-bold bg-teal-600 hover:bg-teal-500 active:scale-95 transition-all shadow-teal-900/20 shadow-xl mb-4"
              >
                Trigger Event
              </Button>

              <Button 
                onClick={() => {
                  setIsPaused((prev) => {
                    const next = !prev;
                    isPausedRef.current = next;
                    if (next) {
                      // Snapshot the current wall-clock time as the pause point
                      pausedTimeRef.current = Date.now();
                    } else {
                      // Accumulate the elapsed pause duration before resuming
                      if (pausedTimeRef.current !== null) {
                        totalPausedDurationRef.current += Date.now() - pausedTimeRef.current;
                        pausedTimeRef.current = null;
                      }
                    }
                    return next;
                  });
                }}
                className={`w-full h-12 text-sm font-semibold transition-all mb-4 gap-2 flex items-center justify-center cursor-pointer ${
                  isPaused 
                    ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20 shadow-xl border border-transparent" 
                    : "border border-zinc-700 hover:bg-zinc-800 text-white bg-transparent"
                }`}
              >
                {isPaused ? (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Resume Simulation
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 fill-current" />
                    Pause Simulation
                  </>
                )}
              </Button>
              
              <Button 
                onClick={() => setEvents([])}
                variant="outline"
                className="w-full border-zinc-700 hover:bg-zinc-300 text-zinc-900 cursor-pointer"
              >
                Clear Timeline
              </Button>

              {/* Time Window Slider */}
              <div className="mt-8">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Timeline Speed
                  </label>
                  <span className="text-xs font-mono text-zinc-300 bg-zinc-800 px-2 py-1 rounded">
                    {windowMs / 1000}s
                  </span>
                </div>
                <input 
                  type="range" 
                  min="2000" 
                  max="15000" 
                  step="1000"
                  value={windowMs} 
                  onChange={(e) => setWindowMs(Number(e.target.value))}
                  className="w-full accent-teal-500 cursor-pointer"
                />
                <p className="text-[10px] text-zinc-500 mt-2">
                  Adjust how much history is visible on screen.
                </p>
              </div>
            </div>
          </div>

          {/* Timeline Visualization Panel */}
          <div className="md:col-span-3">
            <CanvasTimeline 
              events={events} 
              windowMs={windowMs} 
              isPaused={isPaused}
              pausedTimeRef={pausedTimeRef}
              totalPausedDurationRef={totalPausedDurationRef}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-zinc-800 text-center text-sm text-zinc-500">
        <p>
          Made with love by{' '}
          <a
            href="https://youtube.com/@tapasadhikary"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-400 hover:text-teal-300 transition-colors font-medium underline underline-offset-4"
          >
            tapaScript
          </a>
          . Learn how senior devs think.
        </p>
      </footer>
    </div>
  );
}