import { Link, useLocation } from 'react-router';
import styles from './SiteFooter.module.css';

/**
 * At the foot of every public and signed-in page (product owner, 18 October 2026): help, the
 * information pages and how to reach the team. Not on the team's pages (they have their own
 * menu) or when printing. Links to the privacy policy and terms join it once they're published.
 */
export function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;
  return (
    <footer className={styles.footer}>
      <ul className={styles.links}>
        <li>
          <Link to="/help" className="text-link">
            Help
          </Link>
        </li>
        <li>
          <Link to="/how-it-works" className="text-link">
            How it works
          </Link>
        </li>
        <li>
          <Link to="/for-businesses" className="text-link">
            For businesses
          </Link>
        </li>
        <li>
          <Link to="/suggest" className="text-link">
            Suggest a business
          </Link>
        </li>
        <li>
          <a href="mailto:supportlocalites@gmail.com" className="text-link">
            supportlocalites@gmail.com
          </a>
        </li>
      </ul>
      <p className={styles.note}>Localites connects you with local businesses in Orillia and area. Arrange everything directly with them.</p>
    </footer>
  );
}
