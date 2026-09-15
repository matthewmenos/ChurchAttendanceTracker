/**
 * Church brand mark.
 *
 * The logo is the single static file `client/public/icons/logo.png` — the same
 * artwork that backs the favicon, the Apple touch icon and the PWA manifest
 * icons, so church branding has one source of truth.
 *
 * `big` enlarges the mark (used on the sign-in card).
 */
export function Logo({ big = false }) {
  return (
    <span className={'brand-mark logo' + (big ? ' big' : '')} aria-hidden='true'>
      <img src='/icons/logo.png' alt='' className='logo-img' />
    </span>
  );
}

export default Logo;
