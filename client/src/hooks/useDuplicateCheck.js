import { useEffect, useRef, useState } from 'react';
import useDebounce from './useDebounce.js';
import { api } from '../api/client.js';

const IDLE = { checking: false, duplicate: null, member: null, matchedOn: [] };

/**
 * Live duplicate pre-check for the member forms (admin + usher).
 *
 * The server rule: a member is a duplicate when at least 2 of the 3
 * identifying fields (full name, birthday, phone) match an existing member.
 * With fewer than 2 fields filled in a duplicate is impossible, so no
 * request is fired until that threshold is reached.
 *
 * Runs debounced (300 ms), ignores stale responses when the user keeps
 * typing, and treats network failures as "unknown" - the server's hard
 * check still runs at submit time.
 *
 * Returns { checking, duplicate, member, matchedOn } where duplicate is
 * true / false / null (null = no answer yet, e.g. offline).
 */
export default function useDuplicateCheck(
  { fullName = '', phone = '', birthday = '', excludeId = null } = {},
  delay = 300
) {
  const [state, setState] = useState(IDLE);
  const dName = useDebounce(fullName.trim(), delay);
  const dPhone = useDebounce(phone.trim(), delay);
  const dBirthday = useDebounce(birthday || '', delay);
  const latest = useRef(0);

  useEffect(() => {
    const filled = [dName, dPhone, dBirthday].filter(Boolean).length;
    if (filled < 2) {
      latest.current += 1; // invalidate any in-flight request
      setState(IDLE);
      return undefined;
    }
    const reqId = latest.current + 1;
    latest.current = reqId;
    setState((s) => ({ ...s, checking: true }));
    api('/members/check-duplicate', {
      params: { fullName: dName, phone: dPhone, birthday: dBirthday, excludeId: excludeId || undefined },
    })
      .then((data) => {
        if (latest.current !== reqId) return; // a newer keystroke superseded this
        setState({
          checking: false,
          duplicate: !!(data && data.duplicate),
          member: (data && data.member) || null,
          matchedOn: (data && data.matchedOn) || [],
        });
      })
      .catch(() => {
        if (latest.current !== reqId) return;
        setState(IDLE);
      });
    return undefined;
  }, [dName, dPhone, dBirthday, excludeId]);

  return state;
}
