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
    // iOS reports a NEGATIVE scrollY while the page rubber-bands at the very
    // top, so this must be "<= 0" rather than "=== 0" - otherwise the gesture
    // can never arm on the device this app is mostly used on.
    const winY = window.scrollY || 0;
    if (!el) return winY <= 0;
    return el.scrollTop <= 0 && winY <= 0;
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

  /** How far the finger has travelled DOWNWARDS since the gesture began. */
  const pullDistance = (clientY) => clientY - startPos.current;

  const moveGesture = (clientY) => {
    if (!isActive.current) return;
    const delta = pullDistance(clientY);
    if (delta > 0) {
      dragDistance.current = delta;
      setIndicatorPct(Math.min(delta / REFRESH_THRESHOLD, 1));
    }
  };

  /** Abandons the gesture without refreshing (the user scrolled away instead). */
  const cancelGesture = () => {
    isActive.current = false;
    dragDistance.current = 0;
    setShowIndicator(false);
    setIndicatorPct(0);
  };

  const endGesture = () => {
    if (!isActive.current) return;

    // If we pulled past the threshold, trigger the refresh.
    const shouldRefresh = dragDistance.current >= REFRESH_THRESHOLD;
    cancelGesture();

    if (shouldRefresh) {
      triggerRefresh();
    }
  };

  // Touch handlers
  const onTouchStart = (e) => startGesture(e.touches[0].clientY);
  const onTouchMove = (e) => {
    if (!isActive.current) return;
    // Only take over the gesture for a genuine downward pull while the page is
    // already at the very top. Calling preventDefault() unconditionally - which
    // is what this used to do - cancelled the browser's own scrolling for EVERY
    // touch drag that began at the top of the page, making the app impossible
    // to scroll on a phone. Scrolling up (a negative delta) must fall through
    // untouched so the page moves normally.
    if (pullDistance(e.touches[0].clientY) > 0) {
      e.preventDefault(); // stop the rubber-band bounce while pulling
      moveGesture(e.touches[0].clientY);
    } else {
      // The user has reversed into a normal scroll: hand the gesture back to
      // the browser for the remainder of this touch sequence.
      cancelGesture();
    }
  };
  const onTouchEnd = () => endGesture();

  // Pointer (mouse) handlers -- enables testing on desktop
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') startGesture(e.clientY);
  };
  const onPointerMove = (e) => {
    if (!isActive.current || e.pointerType === 'touch') return;
    // Mirror the touch path: only capture an actual downward pull, so dragging
    // the mouse upward (or selecting text) never gets swallowed.
    if (pullDistance(e.clientY) > 0) {
      e.preventDefault();
      moveGesture(e.clientY);
    } else {
      cancelGesture();
    }
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
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
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
