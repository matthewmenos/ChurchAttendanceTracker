import useFetch from './useFetch.js';
import { api } from '../api/client.js';

/** Shared roster loader for the admin and usher attendance screens. */
export default function useRoster(serviceId, { search = '', groupId = '', status = 'all', memberStatus = 'active' } = {}) {
  return useFetch(
    () =>
      serviceId
        ? api(`/attendance/roster/${serviceId}`, { params: { search, groupId, status, memberStatus } })
        : Promise.resolve(null),
    [serviceId, search, groupId, status, memberStatus]
  );
}