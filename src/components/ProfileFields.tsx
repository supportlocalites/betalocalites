import { type Ref, useState } from 'react';
import { useFetcher } from 'react-router';
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
export function ProfileFields({
  values,
  errors,
  finder,
}: {
  values: ProfileValues | null;
  errors: Record<string, string>;
  /** Find my address (Edit profile, signed in): whether their home is on their map now. */
  finder?: { onMap: boolean };
}) {
  const [gender, setGender] = useState(values?.gender ?? '');
  // The address boxes, so a place chosen from Find my address can fill them in.
  const [address, setAddress] = useState({
    streetAddress: values?.streetAddress ?? '',
    unit: values?.unit ?? '',
    town: values?.town ?? '',
    province: values?.province ?? 'ON',
    postalCode: values?.postalCode ?? '',
  });
  // Where the chosen place is: sent with the form, and dropped if the address is typed over.
  const [home, setHome] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [onMap, setOnMap] = useState(finder?.onMap ?? false);
  const typed = (name: keyof typeof address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAddress((a) => ({ ...a, [name]: e.target.value }));
    if (name !== 'unit') {
      setHome(null);
      setOnMap(false);
    }
  };
  const box = (name: keyof typeof address, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="input"
        value={address[name]}
        onChange={typed(name)}
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
        {finder && (
          <AddressFinder
            onMap={onMap}
            chosen={home?.label ?? null}
            onChoose={(p) => {
              setAddress((a) => ({
                streetAddress: p.streetAddress ?? a.streetAddress,
                unit: a.unit,
                town: p.town ?? a.town,
                province: p.province ?? a.province,
                postalCode: p.postalCode ?? a.postalCode,
              }));
              setHome({ lat: p.lat, lng: p.lng, label: p.label });
              setOnMap(true);
            }}
          />
        )}
        {home && (
          <>
            <input type="hidden" name="homeLat" value={home.lat} />
            <input type="hidden" name="homeLng" value={home.lng} />
          </>
        )}
        {box('streetAddress', 'Street address', { maxLength: 200, autoComplete: 'address-line1' })}
        {box('unit', 'Apartment or unit', { maxLength: 40, autoComplete: 'address-line2' })}
        {box('town', 'Town or city', { maxLength: 100, autoComplete: 'address-level2' })}
        <div className={styles.pair}>
          <div className="field">
            <label htmlFor="province" className="field-label">
              Province
            </label>
            <select id="province" name="province" className="input" value={address.province} onChange={typed('province')} autoComplete="address-level1">
              {Object.entries(PROVINCES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {box('postalCode', 'Postal code', { maxLength: 7, autoComplete: 'postal-code', autoCapitalize: 'characters' })}
        </div>
      </fieldset>
      <p className={`field-hint ${styles.note}`}>
        Businesses never see these details. We use them, without your name, to improve Localites and to show businesses
        totals (for example, how many people from Orillia looked at them).
      </p>
    </>
  );
}

type FoundPlace = { label: string; streetAddress: string | null; town: string | null; province: string | null; postalCode: string | null; lat: number; lng: number };

/**
 * Find my address (the owner, 27 October 2026: "bring up that address looker and make sure I
 * select the right address and then can autofill in my info"): type it, press Find, choose the
 * right one; it fills in the boxes below and, once saved, puts a house on your own Browse local
 * map. One search per press (the free address search allows no searching while typing).
 */
function AddressFinder({ onMap, chosen, onChoose }: { onMap: boolean; chosen: string | null; onChoose: (p: FoundPlace) => void }) {
  const search = useFetcher<{ places: FoundPlace[]; problem: string | null }>();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const find = () => {
    if (q.trim().length < 4) return;
    setOpen(true);
    void search.load(`/account/address-search?q=${encodeURIComponent(q.trim())}`);
  };
  const places = search.data?.places ?? [];
  return (
    <div className={styles.finder}>
      <label htmlFor="address-find" className="field-label">
        Find my address
      </label>
      <div className={styles.finderRow}>
        <input
          id="address-find"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter finds, rather than saving the form half-filled.
            if (e.key === 'Enter') {
              e.preventDefault();
              find();
            }
          }}
          placeholder="Like “12 Mississaga St, Orillia”"
          autoComplete="off"
          maxLength={200}
        />
        <button type="button" className="button" onClick={find} disabled={search.state !== 'idle' || q.trim().length < 4}>
          {search.state !== 'idle' ? 'Finding…' : 'Find'}
        </button>
      </div>
      {open && search.state === 'idle' && search.data && (
        <div className={styles.finderResults} aria-live="polite">
          {search.data.problem && <p className="field-hint">{search.data.problem}</p>}
          {places.length > 0 && (
            <>
              <p className="field-hint">Choose yours:</p>
              <ul className={styles.finderList}>
                {places.map((p) => (
                  <li key={p.label}>
                    <button
                      type="button"
                      className={styles.finderPlace}
                      onClick={() => {
                        onChoose(p);
                        setOpen(false);
                      }}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className={`field-hint ${styles.finderNote}`} role="status">
        {chosen
          ? `Chosen: ${chosen}. Save to keep it; your home then shows on your map.`
          : onMap
            ? 'Your home shows on your Browse local map. Only you can see it.'
            : 'Choose your address here to fill in the boxes and show your home on your Browse local map. Only you can see it.'}
      </p>
    </div>
  );
}
