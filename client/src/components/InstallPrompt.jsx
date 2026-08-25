import { useEffect, useState } from 'react';
import { IconDownload } from './ui/icons.jsx';

/**
 * "Install app" button.  Appears only when the browser fires
 * `beforeinstallprompt` (installable PWA criteria met) and the app is not
 * already running in standalone mode.  Hides after install completes.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setDone(true);
      return undefined;
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setDone(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (done || !deferred) return null;

  const promptInstall = async () => {
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch (e) {
      /* user choice unavailable — ignore */
    }
    setDeferred(null);
  };

  return (
    <button type='button' className='install-btn' onClick={promptInstall}>
      <IconDownload size={16} /> Install app
    </button>
  );
}