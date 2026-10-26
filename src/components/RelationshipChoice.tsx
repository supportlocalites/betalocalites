import { type Relationship, RELATIONSHIPS } from '@/lib/claim-terms';
import styles from './RelationshipChoice.module.css';

const HINTS: Record<Relationship, string> = {
  owner: 'It’s my business',
  manager: 'I run it for the owner',
  employee: 'I’m on the staff',
  other: 'Tell us in the note',
};

/**
 * "How are you connected to it?" as four tiles, used by Claim and Add my business (D-63).
 * Real radio buttons underneath, so it works with a keyboard and without JavaScript.
 */
export function RelationshipChoice({ legend, error, defaultValue }: { legend: string; error?: string; defaultValue?: string }) {
  return (
    <fieldset className={styles.choices} aria-describedby={error ? 'relationship-error' : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.tiles}>
        {(Object.entries(RELATIONSHIPS) as [Relationship, string][]).map(([value, label]) => (
          <label key={value} className={styles.tile}>
            <input type="radio" name="relationship" value={value} required defaultChecked={defaultValue === value} />
            <span className={styles.tick} aria-hidden="true" />
            <span className={styles.words}>
              <span className={styles.label}>{label}</span>
              <span className={styles.hint}>{HINTS[value]}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id="relationship-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
