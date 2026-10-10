import styles from './Wordmark.module.css';

/** A plain black map pin with a round window (D-31; the product owner chose it over a glossy one). */
export const PIN_PATH =
  'M12 0C5.37 0 0 5.37 0 12c0 7.6 9.1 18.6 11.1 21a1.2 1.2 0 0 0 1.8 0C14.9 30.6 24 19.6 24 12 24 5.37 18.63 0 12 0zM12 6.6a5.4 5.4 0 1 1 0 10.8a5.4 5.4 0 0 1 0-10.8z';

/**
 * "Localites" with a black map pin as the dot of the i (design-system §6, D-31).
 * Screen readers and search engines get the plain word; the drawn version is hidden from them.
 */
export function Wordmark({ suffix = '', small = false }: { suffix?: string; small?: boolean }) {
  return (
    <>
      <span className="visually-hidden">Localites{suffix}</span>
      <span aria-hidden="true" className={small ? `${styles.mark} ${styles.small}` : styles.mark}>
        Local
        <span className={styles.anchor}>
          <svg className={styles.pin} viewBox="0 0 24 34" focusable="false">
            <path className={styles.body} fillRule="evenodd" d={PIN_PATH} />
          </svg>
        </span>
        {'ıtes'}
        {suffix}
      </span>
    </>
  );
}
