import { type ReactNode, useEffect, useRef } from 'react';
import { Form } from 'react-router';
import { BOOKED_SEES, PLAN_LIMITS } from '@/lib/plan-terms';
import type { EventField, EventValues } from '@/server/event-input';
import styles from './EventForm.module.css';

/**
 * Screen C2 (plan an event, edit its details) and C4's quick form (D-39): the event's name
 * is needed, then the date and the town; the kind of event is optional, one tap. Everything
 * else waits behind "Add more details". The same rules are checked on the server
 * (src/server/event-input.ts) and again by the database.
 */

export type EventFormOptions = { types: { id: string; name: string }[]; towns: { id: string; name: string }[] };
export type EventFormErrors = Partial<Record<EventField, string>>;

/** A saved event's values as the form's boxes show them. */
export function eventFields(v: EventValues): Record<string, string> {
  const text = (n: number | null) => (n === null ? '' : String(n));
  return {
    title: v.title,
    typeId: v.typeId ?? 'none',
    date: v.date,
    townId: v.townId,
    startTime: v.startTime ?? '',
    endTime: v.endTime ?? '',
    guests: text(v.guests),
    ageMin: text(v.ageMin),
    ageMax: text(v.ageMax),
    venueNote: v.venueNote ?? '',
    budget: v.budgetCents === null ? '' : (v.budgetCents / 100).toFixed(v.budgetCents % 100 === 0 ? 0 : 2),
    notes: v.notes ?? '',
  };
}

const DETAILS: EventField[] = ['startTime', 'endTime', 'guests', 'ageMin', 'ageMax', 'venueNote', 'budget', 'notes'];

export function EventForm({
  mode,
  options,
  fields,
  errors,
  dates,
  busy,
  intent,
  submitLabel,
  children,
}: {
  /** new and edit: the whole form (C2); quick: name, kind, date and town (C4). */
  mode: 'new' | 'edit' | 'quick';
  options: EventFormOptions;
  fields: Record<string, string>;
  errors: EventFormErrors;
  /** The dates an event may have (Toronto), the same as the server's. */
  dates: { min: string; max: string };
  busy: boolean;
  intent?: string;
  submitLabel: string;
  /** Lines shown just above the button. */
  children?: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorList = Object.keys(errors);
  // After a refused save, the first box to fix gets the focus.
  useEffect(() => {
    if (errorList.length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, errorList.length]);

  const value = (k: string) => fields[k] ?? '';
  const describedBy = (k: EventField, hint?: string) => [errors[k] ? `${k}-error` : '', hint ?? ''].filter(Boolean).join(' ') || undefined;
  const error = (k: EventField) =>
    errors[k] ? (
      <p className="field-error" id={`${k}-error`}>
        {errors[k]}
      </p>
    ) : null;
  const box = (k: EventField, label: string, props: React.InputHTMLAttributes<HTMLInputElement>, hint?: string) => (
    <div className="field">
      <label htmlFor={k} className="field-label">
        {label}
      </label>
      {hint && (
        <p className="field-hint" id={`${k}-hint`}>
          {hint}
        </p>
      )}
      <input
        id={k}
        name={k}
        className="input"
        defaultValue={value(k)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={describedBy(k, hint ? `${k}-hint` : undefined)}
        {...props}
      />
      {error(k)}
    </div>
  );

  const chosenType = value('typeId') || 'none';
  const detailsOpen = mode === 'edit' ? DETAILS.some((k) => value(k) !== '') : DETAILS.some((k) => errors[k]);

  return (
    <Form method="post" noValidate ref={formRef}>
      {intent && <input type="hidden" name="intent" value={intent} />}
      {errorList.length > 0 && (
        <p className="notice" role="alert">
          Please check what’s marked below.
        </p>
      )}

      {box(
        'title',
        'Name your event',
        { maxLength: PLAN_LIMITS.title, required: true, autoComplete: 'off' },
        'Like “Sam’s party”. Guests you invite see this name; businesses never do. No need to use a child’s full name.',
      )}

      <fieldset className={styles.chips} aria-describedby={errors.typeId ? 'typeId-error' : undefined}>
        <legend>What kind of event? (optional)</legend>
        <div className={styles.chipRow}>
          <label className={styles.chip}>
            <input type="radio" name="typeId" value="none" defaultChecked={chosenType === 'none'} />
            <span>None</span>
          </label>
          {options.types.map((t) => (
            <label key={t.id} className={styles.chip}>
              <input type="radio" name="typeId" value={t.id} defaultChecked={chosenType === t.id} />
              <span>{t.name}</span>
            </label>
          ))}
        </div>
        {error('typeId')}
      </fieldset>

      <div className={styles.pair}>
        {box('date', 'Date', { type: 'date', min: dates.min, max: dates.max, required: true })}
        <div className="field">
          <label htmlFor="townId" className="field-label">
            Town
          </label>
          <select
            id="townId"
            name="townId"
            className="input"
            defaultValue={value('townId')}
            required
            aria-invalid={errors.townId ? true : undefined}
            aria-describedby={describedBy('townId')}
          >
            <option value="">Choose…</option>
            {options.towns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {error('townId')}
        </div>
      </div>

      {mode === 'quick' ? (
        <p className="field-hint">You can add the time, guests and notes later.</p>
      ) : (
        <details className={styles.more} open={detailsOpen}>
          <summary>Add more details (optional)</summary>
          <div className={styles.pair}>
            {box('startTime', 'Starts', { type: 'time' })}
            {box('endTime', 'Ends', { type: 'time' })}
          </div>
          {box('guests', 'About how many guests?', { inputMode: 'numeric', maxLength: 6 })}
          <div className={styles.pair}>
            {box('ageMin', 'Ages, if it’s for children: from', { inputMode: 'numeric', maxLength: 3 })}
            {box('ageMax', 'to', { inputMode: 'numeric', maxLength: 3 })}
          </div>
          {box('venueNote', 'Where', { maxLength: PLAN_LIMITS.venue }, 'Your guests see this on their invitation. Businesses never do.')}
          {box('budget', 'Budget', { inputMode: 'decimal', maxLength: 14 }, 'Only you can see this. Localites doesn’t process payments.')}
          <div className="field">
            <label htmlFor="notes" className="field-label">
              Notes
            </label>
            <p className="field-hint" id="notes-hint">
              Only you can see this.
            </p>
            <textarea
              id="notes"
              name="notes"
              className="input"
              defaultValue={value('notes')}
              maxLength={PLAN_LIMITS.notes}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={describedBy('notes', 'notes-hint')}
            />
            {error('notes')}
          </div>
        </details>
      )}

      {mode !== 'quick' && <p className={styles.privacy}>{BOOKED_SEES}</p>}
      {children}
      <button type="submit" className={`button button-primary ${styles.submit}`} disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </Form>
  );
}
