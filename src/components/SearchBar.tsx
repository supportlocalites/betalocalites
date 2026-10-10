import styles from './SearchBar.module.css';

export function SearchBar({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" role="search" className={styles.form}>
      <label htmlFor="q" className="visually-hidden">
        Search local businesses
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Search face painters, cakes, venues…"
        className={styles.input}
        maxLength={100}
        autoComplete="off"
      />
      <button type="submit" className={`button button-primary ${styles.submit}`}>
        Search
      </button>
    </form>
  );
}
