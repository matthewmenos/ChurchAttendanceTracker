import { useEffect, useRef, useState } from 'react';
import { IconRefresh } from './ui/icons.jsx';
import { usePullToRefresh } from '../context/PullToRefreshContext.jsx';

/** Threshold (px of downward drag) before a release triggers the refresh. */
const REFRESH_THRESHOLD = 80;

/**
 * Wraps a scrollable page (typically an <Outlet />) and adds a native-style
 * "pull to refresh" gesture: when the user is scrolled to the very top and
 * drags downward past REFRESH_THRESHOLD, a spinner overlay grows and the app
 * refreshes on release.
 *
 * Works with both touch events (phones/tablets) and pointer/mouse events
 * (desktop browsers) so the gesture is testable everywhere.
 */
export default function PullToRefresh({ children }) {
  const { triggerRefresh } = usePullToRefresh();
  const containerRef = useRef(null);
  const [indicatorPct, setIndicatorPct] = useState(0); // 0 -> 1
  const [showIndicator, setShowIndicator] = useState(false);

  const startPos = useRef(0);
  const dragDistance = useRef(0);
  const isActive = useRef(false);

  const isAtTop = () => {
    const el = containerRef.current;
    if (!el) return window.scrollY === 0;
    return el.scrollTop === 0 && window.scrollY === 0;
  };

  const startGesture = (clientY) => {
    if (!isAtTop()) return false;
    isActive.current = true;
    startPos.current = clientY;
    dragDistance.current = 0;
    setShowIndicator(true);
    setIndicatorPct(0);
    return true;
  };

  const moveGesture = (clientY) => {
    if (!isActive.current) return;
    const delta = clientY - startPos.current;
    if (delta > 0) {
      dragDistance.current = delta;
      setIndicatorPct(Math.min(delta / REFRESH_THRESHOLD, 1));
    }
  };

  const endGesture = () => {
    if (!isActive.current) return;
    isActive.current = false;
    setShowIndicator(false);
    setIndicatorPct(0);

    // If we pulled past the threshold, trigger the refresh.
    const shouldRefresh = dragDistance.current >= REFRESH_THRESHOLD;
    dragDistance.current = 0;

    if (shouldRefresh) {
      triggerRefresh();
    }
  };

  // Touch handlers
  const onTouchStart = (e) => startGesture(e.touches[0].clientY);
  const onTouchMove = (e) => {
    if (!isActive.current) return;
    e.preventDefault(); // prevent body scroll bounce while pulling
    moveGesture(e.touches[0].clientY);
  };
  const onTouchEnd = () => endGesture();

  // Pointer (mouse) handlers -- enables testing on desktop
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') startGesture(e.clientY);
  };
  const onPointerMove = (e) => {
    if (!isActive.current || e.pointerType === 'touch') return;
    e.preventDefault();
    moveGesture(e.clientY);
  };
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') endGesture();
  };

  // Attach listeners to the container element
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return (
    <div ref={containerRef} className='pull-to-refresh-container'>
      {children}
      {showIndicator && (
        <div
          className='ptr-indicator'
          style={{
            transform: `translateY(${indicatorPct * 60}px)`,
            opacity: 0.3 + indicatorPct * 0.7,
          }}
        >
          <IconRefresh
            size={24}
            style={{
              animation:
                indicatorPct >= 1 ? 'cat-spin 0.6s linear infinite' : 'none',
              color: 'var(--blue-600)',
            }}
          />
          <span>
            {indicatorPct >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}
    </div>
  );
}
