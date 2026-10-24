import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBook, useLibrary, useThemes } from '../../api/hooks';
import { MEDIA_ACCEPT } from '../../lib/upload';
import { EditPanel } from './EditPanel';
import { Reader } from './Reader';
import { useBookEditor } from './useBookEditor';

/** The reader with its editor wired in. */
export function BookScreen() {
  const { id = '' } = useParams();
  const content = useBook(id).data;
  const themes = useThemes().data;
  const lib = useLibrary().data;
  const heroRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<{ side: 'L' | 'R'; L: number; single: boolean } | null>(null);
  const nav = useRef<{ goTo: (t: number) => void; select: (id: string | null) => void }>({ goTo: () => {}, select: () => {} });
  const [, force] = useState(0);
  const editor = useBookEditor(id, {
    autoCaption: !!lib?.settings.aiAuto,
    goTo: (t) => nav.current.goTo(t),
    select: (pid) => nav.current.select(pid),
  });

  return (
    <>
      <Reader
        loading={editor.loading}
        edit={{
          panel: ({ L, single, goTo, selPhoto, setSelPhoto }) => {
            nav.current = { goTo, select: setSelPhoto };
            if (!content || !themes) return null;
            return <EditPanel content={content} themes={themes} L={L} single={single} goTo={goTo} selPhoto={selPhoto} setSelPhoto={setSelPhoto} editor={editor} onPickHero={() => heroRef.current?.click()} />;
          },
          pageDrop: (side, files, L, single) => {
            const pages = content?.pages ?? [];
            const idxs = single ? [L] : [L, L + 1];
            const titleIdx = pages.findIndex((p) => p.type === 'title');
            // Dropping on the title spread replaces the cover photo.
            if (idxs.includes(titleIdx) && !idxs.some((i) => pages[i]?.layout)) return void editor.replaceHero(files);
            void editor.uploadToSpread(files, L, single, side);
          },
          onHero: () => heroRef.current?.click(),
          movePhoto: (pid, toIdx, position) => void editor.movePhoto(pid, toIdx, position),
          pickPhotos: (side, L, single) => {
            pickTarget.current = { side, L, single };
            photosRef.current?.click();
          },
        }}
      />
      <input
        ref={photosRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const t = pickTarget.current;
          if (e.target.files?.length && t) void editor.uploadToSpread(e.target.files, t.L, t.single, t.side);
          e.target.value = '';
        }}
      />
      <input
        ref={heroRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files) void editor.replaceHero(e.target.files);
          e.target.value = '';
          force((n) => n + 1);
        }}
      />
    </>
  );
}
