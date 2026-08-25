import useFetch from './useFetch.js';
import { api } from '../api/client.js';

/** Shared roster loader for the admin and usher attendance screens.
 *  Paginated server-side: pass a growing pageSize to reveal more members. */
export default function useRoster(serviceId, { search = '', groupId = '', status = 'all', memberStatus = 'active', pageSize = 50 } = {}) {
  return useFetch(
    () =>
      serviceId
        ? api(`/attendance/roster/${serviceId}`, { params: { search, groupId, status, memberStatus, pageSize } })
        : Promise.resolve(null),
    [serviceId, search, groupId, status, memberStatus, pageSize]
  );
}