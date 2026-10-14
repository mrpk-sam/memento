import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { qk } from '../../api/hooks';
import type { Library, PeopleData, Theme } from '../../api/types';

/** Numbers shown beside each Desk tab. Only fetches what the user can see. */
export function useDeskCounts(tabs: string[]): Record<string, number | string> {
  const people = useQuery({ queryKey: qk.people, queryFn: () => api<PeopleData>('/people'), enabled: tabs.includes('family') });
  const inbox = useQuery({ queryKey: [...qk.inbox, 'count'], queryFn: () => api<{ count: number }>('/inbox/count'), enabled: tabs.includes('inbox') });
  const themes = useQuery({ queryKey: qk.themes, queryFn: () => api<Theme[]>('/themes'), enabled: tabs.includes('themes') });
  const lib = useQuery({ queryKey: qk.library, queryFn: () => api<Library>('/library'), enabled: tabs.includes('books') });
  const requests = useQuery({ queryKey: qk.requests, queryFn: () => api<{ requests: unknown[] }>('/access-requests'), enabled: tabs.includes('family') });
  const asking = requests.data?.requests.length ?? 0;
  return {
    family: people.data ? `${people.data.people.length}${asking ? ` · ${asking} new` : ''}` : '',
    books: lib.data?.books.length ?? '',
    inbox: inbox.data?.count || '',
    themes: themes.data?.length ?? '',
  };
}
