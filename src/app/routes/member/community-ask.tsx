import { data, redirect } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { COMMUNITY_LIMITS, type CommunityProblem } from '@/lib/community-terms';
import {
  abandonPhotos,
  checkPhotoRoom,
  MAX_POST_UPLOAD,
  PhotoProblem,
  readPostPhotos,
  type StoredPhoto,
  storePostPhotos,
} from '@/server/community-photos.server';
import { askQuestion, CommunityRefused } from '@/server/community.server';
import { discardBody } from '@/server/discard-body';
import { tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/community-ask';

/**
 * Asking a Community question (D-62): needs an account (the member gate). The form is on
 * /community; anything refused goes back there with the reason in plain words.
 */
export async function loader() {
  return redirect('/community');
}

const back = (problem: CommunityProblem) => redirect(`/community?problem=${problem}`);

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  // Up to 3 photos with it (0063): anything clearly bigger is refused before it's read.
  const size = request.headers.get('content-length');
  // Browsers always say how big a form is; one that doesn't isn't read either (as conversations).
  if (size === null || !/^\d{1,9}$/.test(size) || Number(size) > MAX_POST_UPLOAD) {
    await discardBody(request);
    return back('photoTooMany');
  }
  const form = await request.formData();
  const title = String(form.get('title') ?? '').replace(/\s+/g, ' ').trim();
  const detail = String(form.get('detail') ?? '').trim() || null;
  const kind = String(form.get('kind') ?? '').trim() || null;
  if (title.length < COMMUNITY_LIMITS.title.min || title.length > COMMUNITY_LIMITS.title.max) {
    return back('title');
  }
  if (detail && detail.length > COMMUNITY_LIMITS.detail) return back('detail');
  if (kind && !/^[a-z0-9-]{1,80}$/.test(kind)) throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return back('tooFast');
  let stored: StoredPhoto[] = [];
  try {
    const photos = await readPostPhotos(form);
    await checkPhotoRoom(env, photos);
    stored = await storePostPhotos(env, photos);
    const asked = await askQuestion(env, member.userId, { title, detail, kindSlug: kind }, stored);
    return redirect(asked.held ? '/community?asked=held' : `/community/${asked.id}${stored.length ? '?photos=waiting' : ''}`);
  } catch (err) {
    // Not posted: photos already stored for it go again.
    await abandonPhotos(env, stored);
    if (err instanceof PhotoProblem) return back(err.code);
    if (err instanceof CommunityRefused) return back(err.code);
    throw err;
  }
}
