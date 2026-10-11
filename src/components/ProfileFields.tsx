import { type Ref, useState } from 'react';
import { GENDERS, PROVINCES } from '@/lib/claim-terms';
import styles from './ProfileFields.module.css';

export type ProfileValues = {
  gender: string | null;
  genderSelfDescribed: string | null;
  dateOfBirth: string | null;
  streetAddress: string | null;
  unit: string | null;
  town: string | null;
  province: string | null;
  postalCode: string | null;
};

/**
 * First and last name, side by side on wider screens (D-36). Both are needed to continue,
 * but, like the details below, neither is labelled as required.
 */
export function NameFields({
  first,
  last,
  errors,
  firstRef,
}: {
  first: string | null;
  last: string | null;
  errors: Record<string, string>;
  firstRef?: Ref<HTMLInputElement>;
}) {
  const box = (name: 'firstName' | 'lastName', label: string, value: string | null, autoComplete: string, ref?: Ref<HTMLInputElement>) => (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <input
        ref={ref}
        id={name}
        name={name}
        className="input"
        defaultValue={value ?? ''}
        autoComplete={autoComplete}
        maxLength={59}
        required
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={[errors[name] ? `${name}-error` : '', 'name-hint'].filter(Boolean).join(' ')}
      />
      {errors[name] && (
        <p className="field-error" id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );
  return (
    <>
      <div className={styles.pair}>
        {box('firstName', 'First name', first, 'given-name', firstRef)}
        {box('lastName', 'Last name', last, 'family-name')}
      </div>
      <p className={`field-hint ${styles.nameHint}`} id="name-hint">
        Shown to our team, and to a business when you contact it.
      </p>
    </>
  );
}

/**
 * Personal details (D-36), on "Welcome to Localites" and "Your account". None is required,
 * and none is labelled either way: people fill in what they're happy to.
 */
export function ProfileFields({ values, errors }: { values: ProfileValues | null; errors: Record<string, string> }) {
  const [gender, setGender] = useState(values?.gender ?? '');
  const field = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
    value: string | null | undefined,
  ) => (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="input"
        defaultValue={value ?? ''}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        {...props}
      />
      {errors[name] && (
        <p className="field-error" id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="field">
        <label htmlFor="gender" className="field-label">
          Gender
        </label>
        <select id="gender" name="gender" className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Choose…</option>
          {Object.entries(GENDERS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {gender === 'self_described' &&
        field('genderOther', 'In your own words', { maxLength: 60, autoComplete: 'off' }, values?.genderSelfDescribed)}
      {field('dateOfBirth', 'Date of birth', { type: 'date', min: '1900-01-01', autoComplete: 'bday' }, values?.dateOfBirth)}

      <fieldset className={styles.address}>
        <legend className="field-label">Address</legend>
        {field('streetAddress', 'Street address', { maxLength: 200, autoComplete: 'address-line1' }, values?.streetAddress)}
        {field('unit', 'Apartment or unit', { maxLength: 40, autoComplete: 'address-line2' }, values?.unit)}
        {field('town', 'Town or city', { maxLength: 100, autoComplete: 'address-level2' }, values?.town)}
        <div className={styles.pair}>
          <div className="field">
            <label htmlFor="province" className="field-label">
              Province
            </label>
            <select id="province" name="province" className="input" defaultValue={values?.province ?? 'ON'} autoComplete="address-level1">
              {Object.entries(PROVINCES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {field('postalCode', 'Postal code', { maxLength: 7, autoComplete: 'postal-code', autoCapitalize: 'characters' }, values?.postalCode)}
        </div>
      </fieldset>
      <p className={`field-hint ${styles.note}`}>
        Businesses never see these details. We use them, without your name, to improve Localites and to show businesses
        totals (for example, how many people from Orillia looked at them).
      </p>
    </>
  );
}
