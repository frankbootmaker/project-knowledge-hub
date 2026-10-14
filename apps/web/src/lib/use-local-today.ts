'use client';

import { useSyncExternalStore } from 'react';
import { localDateIso, utcDateIso } from './delivery-completion';

function subscribe(): () => void {
  return () => {};
}

/**
 * Calendar day for labels that render on the server and the client.
 * The server snapshot is UTC so the first paint matches. After hydration
 * the viewer's local day replaces it.
 */
export function useLocalToday(): string {
  return useSyncExternalStore(subscribe, localDateIso, utcDateIso);
}
