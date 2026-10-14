import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { AccessRequest, AiSettings, BookContent, InboxData, Library, Me, PeopleData, Theme } from './types';

export const qk = {
  me: ['me'] as const,
  people: ['people'] as const,
  library: ['library'] as const,
  book: (id: string) => ['book', id] as const,
  themes: ['themes'] as const,
  ai: ['ai'] as const,
  inbox: ['inbox'] as const,
  requests: ['access-requests'] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/me'), retry: false, staleTime: 60_000 });
export const usePeople = () => useQuery({ queryKey: qk.people, queryFn: () => api<PeopleData>('/people') });
export const useLibrary = () => useQuery({ queryKey: qk.library, queryFn: () => api<Library>('/library') });
export const useBook = (id: string) => useQuery({ queryKey: qk.book(id), queryFn: () => api<BookContent>(`/books/${id}`) });
export const useThemes = () => useQuery({ queryKey: qk.themes, queryFn: () => api<Theme[]>('/themes'), staleTime: 5 * 60_000 });
export const useAi = () => useQuery({ queryKey: qk.ai, queryFn: () => api<AiSettings>('/ai') });
export const useInbox = () => useQuery({ queryKey: qk.inbox, queryFn: () => api<InboxData>('/inbox') });
export const useAccessRequests = (enabled = true) => useQuery({ queryKey: qk.requests, queryFn: () => api<{ requests: AccessRequest[] }>('/access-requests'), enabled });
