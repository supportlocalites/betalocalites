import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1 className="title-1">We couldn&rsquo;t find that page</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">It may have moved, or the business may no longer be listed.</p>
        <Link href="/explore" className="button button-primary">
          Back to Explore
        </Link>
      </main>
    </>
  );
}
