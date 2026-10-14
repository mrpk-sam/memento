import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk } from '../api/hooks';
import type { BookContent, Library, LibraryBook } from '../api/types';
import { useToast } from './toast';

type BookPatch = Partial<Pick<LibraryBook, 'spineText' | 'texture' | 'color' | 'width' | 'height' | 'ownerName' | 'householdId' | 'locked'>>;

/**
 * Applies a book edit to the cached library at once, then saves it after a short pause.
 * Slider drags and typing collapse into one request per book.
 */
export function useBookPatch(delay = 400) {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useRef(new Map<string, { patch: BookPatch; timer: ReturnType<typeof setTimeout> }>());

  return useCallback(
    (id: string, patch: BookPatch) => {
      qc.setQueryData<Library>(qk.library, (lib) => lib && { ...lib, books: lib.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
      qc.setQueryData<BookContent>(qk.book(id), (c) => c && { ...c, book: { ...c.book, ...(patch as Partial<BookContent['book']>) } });
      const cur = pending.current.get(id);
      if (cur) clearTimeout(cur.timer);
      const merged = { ...cur?.patch, ...patch };
      const timer = setTimeout(async () => {
        pending.current.delete(id);
        try {
          await api(`/books/${id}`, { method: 'PATCH', body: merged });
        } catch (e) {
          toast(errorMessage(e));
        }
        await qc.invalidateQueries({ queryKey: qk.library });
        await qc.invalidateQueries({ queryKey: qk.book(id) });
        if ('householdId' in merged || 'ownerName' in merged) await qc.invalidateQueries({ queryKey: qk.people });
      }, delay);
      pending.current.set(id, { patch: merged, timer });
    },
    [qc, toast, delay],
  );
}
