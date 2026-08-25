import { IconChurch } from './icons.jsx';
import { useLogo } from '../../hooks/useLogo.js';

/**
 * Renders a brand-mark span.  When the configured church logo exists as a
 * data-URI it shows an <img> inside a transparent `.brand-mark logo` wrap;
 * otherwise it falls back to the IconChurch glyph on the standard yellow
 * `.brand-mark` background.
 *
 * `size` only affects the fallback icon.  When a logo is present the full
 * brand-mark area is used for the image.
 */
export function Logo({ size = 22 }) {
  const logo = useLogo();
  const classes = 'brand-mark' + (logo ? ' logo' : '');
  if (logo) {
    return (
      <span className={classes} aria-hidden='true'>
        <img src={logo} alt='' className='logo-img' />
      </span>
    );
  }
  return (
    <span className={classes} aria-hidden='true'>
      <IconChurch size={size} />
    </span>
  );
}

export default Logo;


