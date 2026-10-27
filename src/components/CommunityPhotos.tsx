import { useState } from 'react';
import { useSubmit } from 'react-router';
import { prepareOnePhoto } from '@/lib/photo-prepare';
import styles from './CommunityPhotos.module.css';

/**
 * Photos with a Community question or answer (the owner, 27 October 2026, migration 0063): up to
 * 3, made smaller by the browser (and their hidden details such as where they were taken left
 * behind) before they're sent; each waits for our team before anyone else sees it.
 */

export const MAX_PHOTOS = 3;

export type PostPhoto = { id: string; waiting: boolean; width: number | null; height: number | null };

/** Sending a post with photos: each made smaller first. Without the page's script, they go as chosen. */
export function usePhotoSubmit(action: string) {
  const submit = useSubmit();
  const [problem, setProblem] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    setProblem(null);
    const input = event.currentTarget.elements.namedItem('photos');
    const files = input instanceof HTMLInputElement ? [...(input.files ?? [])] : [];
    if (files.length === 0) return; // sent as it is
    event.preventDefault();
    if (files.length > MAX_PHOTOS) {
      setProblem(`Up to ${MAX_PHOTOS} photos with a post.`);
      return;
    }
    const form = new FormData(event.currentTarget);
    form.delete('photos');
    setPreparing(true);
    for (const file of files) {
      const photo = await prepareOnePhoto(file);
      if (!photo) {
        setPreparing(false);
        setProblem('This browser couldn’t open one of those as a photo. Please choose photos only.');
        return;
      }
      form.append('photos', photo);
    }
    setPreparing(false);
    await submit(form, { method: 'post', action, encType: 'multipart/form-data' });
  }
  return { onSubmit, problem, preparing };
}

/** "Add photos (optional)": the file box, saying what happens to them. */
export function PhotoPicker({ problem }: { problem: string | null }) {
  return (
    <div className={styles.picker}>
      <label htmlFor="photos" className="field-label">
        Add photos (optional)
      </label>
      <input id="photos" name="photos" type="file" accept="image/*" multiple aria-describedby="photos-hint" />
      <p className="field-hint" id="photos-hint">
        Up to {MAX_PHOTOS}. Our team checks each photo before anyone else sees it. Photos are made smaller and lose hidden details such as
        where they were taken.
      </p>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A post's photos: shown ones for everyone, and the author's own still waiting, marked so. */
export function PostPhotos({ photos }: { photos: PostPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <ul className={styles.photos} aria-label="Photos">
      {photos.map((p) => (
        <li key={p.id} className={styles.photo}>
          <a href={`/community/photos/${p.id}`} target="_blank" rel="noreferrer">
            <img src={`/community/photos/${p.id}`} alt="" loading="lazy" width={p.width ?? undefined} height={p.height ?? undefined} />
          </a>
          {p.waiting && <span className={styles.waiting}>Waiting for our team: only you can see it</span>}
        </li>
      ))}
    </ul>
  );
}
