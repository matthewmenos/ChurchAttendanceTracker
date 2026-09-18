import { useEffect, useRef, useState } from 'react';
import Logo from './ui/Logo.jsx';

/** How long the video may hold the screen if its 'ended' event never fires. */
const DISMISS_CAP_MS = 6000;
/** How long the logo fallback stays up before fading out. */
const FALLBACK_MS = 1500;
/** Must match the CSS transition on .splash-screen. */
const FADE_MS = 250;

/**
 * Video splash screen.
 *
 * Plays /splash.mp4 full-screen on app open (muted + playsInline so mobile
 * autoplay policies allow it), then fades away when the video ends. No Skip
 * button by design - the clip is ~5 seconds.
 *
 * Fallbacks:
 *  - prefers-reduced-motion: never shown.
 *  - autoplay blocked (e.g. iOS Low Power Mode) or the file missing/offline:
 *    the church logo shows briefly instead, then the app continues.
 *  - the video is deliberately NOT in the PWA precache (a multi-MB clip would
 *    bloat every install); the browser HTTP cache makes repeat opens instant.
 */
export default function SplashScreen() {
  const [state, setState] = useState('show'); // 'show' | 'fading' | 'hidden'
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);

  // Skip everything for users who prefer reduced motion.
  useEffect(() => {
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState('hidden');
    }
  }, []);

  // Safety cap: the app must never hang on the splash if 'ended' never fires.
  useEffect(() => {
    if (state !== 'show') return undefined;
    const cap = setTimeout(() => setState('fading'), DISMISS_CAP_MS);
    return () => clearTimeout(cap);
  }, [state]);

  // Complete the fade, then unmount.
  useEffect(() => {
    if (state !== 'fading') return undefined;
    const t = setTimeout(() => setState('hidden'), FADE_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Autoplay can still be rejected (Low Power Mode) even when muted — fall
  // back to the logo instead of a frozen first frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    let fallbackTimer;
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        setVideoFailed(true);
        fallbackTimer = setTimeout(() => setState('fading'), FALLBACK_MS);
      });
    }
    return () => clearTimeout(fallbackTimer);
  }, []);

  if (state === 'hidden') return null;

  return (
    <div className={`splash-screen${state === 'fading' ? ' fading' : ''}`} aria-hidden='true'>
      {videoFailed
        ? <Logo big />
        : (
          <video
            ref={videoRef}
            className='splash-video'
            src='/splash.mp4'
            autoPlay
            muted
            playsInline
            onEnded={() => setState('fading')}
            onError={() => {
              setVideoFailed(true);
              setTimeout(() => setState('fading'), FALLBACK_MS);
            }}
          />
        )}
    </div>
  );
}
