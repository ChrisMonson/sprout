// Files the person hands a sprout: picked with the paperclip or dropped on the page.

import { useEffect, useState, type ReactNode } from 'react';
import { Close } from './icons.tsx';

export const MAX_FILE_MB = 25;

const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Adds files, skipping repeats and saying which are too big. */
export function useFiles() {
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState('');
  const add = (list: FileList | File[] | null | undefined) => {
    const picked = Array.from(list ?? []);
    const big = picked.filter(f => f.size > MAX_FILE_MB * 1024 * 1024);
    setProblem(big.length ? `${big.map(f => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over ${MAX_FILE_MB} MB.` : '');
    setFiles(current => [...current, ...picked.filter(f => !big.includes(f) && !current.some(c => c.name === f.name && c.size === f.size))]);
  };
  const remove = (file: File) => setFiles(current => current.filter(f => f !== file));
  const clear = () => { setFiles([]); setProblem(''); };
  return { files, problem, add, remove, clear };
}

export function FileChips({ files, onRemove, dark = false }: { files: File[]; onRemove: (file: File) => void; dark?: boolean }) {
  if (!files.length) return null;
  return (
    <div className={`file-chips${dark ? ' dark' : ''}`}>
      {files.map(f => (
        <span key={`${f.name}-${f.size}`} className="file-chip" title={f.name}>
          <span className="n">{f.name}</span><span className="z">{size(f.size)}</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f)}><Close size={10} /></button>
        </span>
      ))}
    </div>
  );
}

/** A form post with files; the server answers JSON either way. */
export async function postFiles<T>(path: string, fields: Record<string, string>, files: File[]): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const f of files) form.append('files', f);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Couldn’t send the files (${res.status}).`);
  return body as T;
}

/**
 * While files are dragged over the window, covers `children`'s area with a
 * drop target (the tool's frame would otherwise swallow the drop).
 */
export function DropZone({ onFiles, label, children }: { onFiles: (files: FileList) => void; label: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) setOver(true); };
    const end = () => setOver(false);
    addEventListener('dragenter', enter);
    addEventListener('drop', end);
    addEventListener('dragend', end);
    return () => { removeEventListener('dragenter', enter); removeEventListener('drop', end); removeEventListener('dragend', end); };
  }, []);
  return (
    <>
      {children}
      {over && (
        <div className="drop-zone" onDragOver={e => e.preventDefault()} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }}
          onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}>
          <span>{label}</span>
        </div>
      )}
    </>
  );
}
