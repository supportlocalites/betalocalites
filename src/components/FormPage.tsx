import type { ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './FormPage.module.css';
import { TopBar } from './TopBar';

/**
 * A page with one form on it (Message your picks, Message a business, Inquire, Report), in the
 * current design (the owner, 27 October 2026: "look at all the functions within it and ensure it
 * is aligned with the current design"): the top bar, then one white card in the middle with a
 * quiet way back, the title, and the form.
 */
export function FormPage({ title, back, children }: { title: string; back?: { to: string; label: string }; children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main className={styles.page}>
        <div className={styles.card}>
          {back && (
            <Link to={back.to} className={styles.back}>
              ← {back.label}
            </Link>
          )}
          <h1 className={styles.title}>{title}</h1>
          {children}
        </div>
      </main>
    </>
  );
}

/** Choices shown as rounded pills that can be ticked (who a Message all goes to). */
export const pickStyles = { list: styles.picks, pick: styles.pick };
