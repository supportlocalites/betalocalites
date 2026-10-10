import type { FormOptions } from '@/server/admin/listings.server';
import styles from '@/app/routes/admin/admin.module.css';

export type ListingValues = {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  municipalityId: string;
  websiteUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  primaryCategoryId: string | null;
  categoryIds: string[];
};

export const emptyListing: ListingValues = {
  name: '',
  slug: '',
  tagline: '',
  description: '',
  municipalityId: '',
  websiteUrl: '',
  publicEmail: '',
  publicPhone: '',
  primaryCategoryId: '',
  categoryIds: [],
};

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hasHint: boolean, error?: string) =>
  [hasHint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

/** The listing's details (screen X2). Only what the business publishes itself (D-03). */
export function ListingFields({
  values,
  options,
  errors = {},
}: {
  values: ListingValues;
  options: FormOptions;
  errors?: Record<string, string>;
}) {
  const input = (id: keyof ListingValues, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hasHint = false) => (
    <input
      id={id}
      name={id}
      defaultValue={(values[id] as string | null) ?? ''}
      className="input"
      aria-invalid={errors[id] ? true : undefined}
      aria-describedby={describedBy(id, hasHint, errors[id])}
      {...props}
    />
  );
  const groups = [...new Set(options.categories.map((c) => c.group))];
  return (
    <>
      <Field id="name" label="Business name" error={errors.name}>
        {input('name', { required: true, maxLength: 160 })}
      </Field>
      <Field
        id="slug"
        label="Web address"
        hint="localites.ca/vendors/… Leave empty to make one from the name. Old addresses keep working."
        error={errors.slug}
      >
        {input('slug', { maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }, true)}
      </Field>
      <Field id="tagline" label="Short description" hint="One line under the name, up to 160 characters." error={errors.tagline}>
        {input('tagline', { maxLength: 160 }, true)}
      </Field>
      <Field id="description" label="About" error={errors.description}>
        <textarea
          id="description"
          name="description"
          defaultValue={values.description ?? ''}
          className="input"
          maxLength={5000}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy('description', false, errors.description)}
        />
      </Field>
      <div className={styles.twoColumns}>
        <Field id="municipalityId" label="Town" error={errors.municipalityId}>
          <select
            id="municipalityId"
            name="municipalityId"
            defaultValue={values.municipalityId}
            className="input"
            required
            aria-invalid={errors.municipalityId ? true : undefined}
          >
            <option value="">Choose…</option>
            {options.towns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="primaryCategoryId" label="Main category" error={errors.primaryCategoryId}>
          <select
            id="primaryCategoryId"
            name="primaryCategoryId"
            defaultValue={values.primaryCategoryId ?? ''}
            className="input"
            required
            aria-invalid={errors.primaryCategoryId ? true : undefined}
          >
            <option value="">Choose…</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {options.categories
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name === g ? `${g} (general)` : c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className={styles.checks}>
        <legend>Also shows in</legend>
        {groups.map((g) => (
          <div key={g} className={styles.checkGroup}>
            <p className="label">{g}</p>
            {options.categories
              .filter((c) => c.group === g)
              .map((c) => (
                <label key={c.id} className={styles.check}>
                  <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={values.categoryIds.includes(c.id)} />
                  {c.name === g ? `${g} (general)` : c.name}
                </label>
              ))}
          </div>
        ))}
      </fieldset>
      <div className={styles.twoColumns}>
        <Field id="websiteUrl" label="Website" error={errors.websiteUrl}>
          {input('websiteUrl', { inputMode: 'url', maxLength: 500 })}
        </Field>
        <Field id="publicPhone" label="Public phone" error={errors.publicPhone}>
          {input('publicPhone', { type: 'tel', maxLength: 20 })}
        </Field>
      </div>
      <Field id="publicEmail" label="Public email" hint="Only an address the business publishes itself." error={errors.publicEmail}>
        {input('publicEmail', { type: 'email', maxLength: 254 }, true)}
      </Field>
    </>
  );
}
