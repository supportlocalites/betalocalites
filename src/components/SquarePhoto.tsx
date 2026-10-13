import { frameOf, type Frame, placement, showsBackdrop } from '@/lib/photo-frame';
import styles from './SquarePhoto.module.css';

export type SquarePhotoData = { url: string; width: number | null; height: number | null; frame: Frame | null };

/**
 * A business's square profile photo (its logo or a photo it likes), framed as its owner
 * chose, or with the smart default (src/lib/photo-frame.ts). When the photo doesn't cover
 * the square, a soft, blurred copy of it fills the rest, so there are never empty bars.
 * No script needed: the framing is plain positioning.
 */
export function SquarePhoto({
  photo,
  alt,
  size = 'list',
  className,
}: {
  photo: SquarePhotoData | null;
  alt: string;
  size?: 'list' | 'profile' | 'large';
  className?: string;
}) {
  const box = `${styles.square} ${styles[size]} ${className ?? ''}`;
  if (!photo) return <span className={`${box} ${styles.empty}`} aria-hidden="true" />;
  const frame = frameOf(photo);
  return (
    <span className={box}>
      {showsBackdrop(frame) && <img src={photo.url} alt="" aria-hidden="true" className={styles.backdrop} loading="lazy" />}
      <img src={photo.url} alt={alt} className={styles.photo} style={placement(frame)} loading="lazy" />
    </span>
  );
}
