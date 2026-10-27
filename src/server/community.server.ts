import { sql } from 'drizzle-orm';
import { COMMUNITY_LIMITS, COMMUNITY_PROBLEMS, type CommunityProblem, type ReportReason } from '@/lib/community-terms';
import { isUuid, uuidv7 } from '@/lib/ids.mjs';
import { actingAs, errorCode } from './acting.server';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { checkLanguage } from './moderation.server';
import { smallPhotoUrl } from './photo-store.server';

/**
 * Community (D-62, migration 0061): questions anyone can read, asked and answered by people
 * signed in, named as "Sarah M." (names only, no neighbourhoods). An answer can suggest one
 * business (on Localites, or a name they type) or just give advice. Up and down votes, the most
 * up-voted first. Posts show straight away; the language check (D-50) holds one for the team
 * instead, anyone can report one, and the team takes one down. The database's own rules (0061)
 * decide who may do each thing; this file reads and writes as the person, or as the team.
 */

/** Refused for a reason the person can act on: its code names the words to show (community-terms). */
export class CommunityRefused extends Error {
  constructor(
    readonly code: CommunityProblem,
    readonly status = 409,
  ) {
    super(COMMUNITY_PROBLEMS[code]);
  }
}

export type Kind = { slug: string; name: string };
export type Business = { slug: string; name: string; kind: string | null; photo: string | null; listed: boolean };
export type FeedQuestion = {
  id: string;
  title: string;
  kind: Kind | null;
  author: string;
  mine: boolean;
  held: boolean;
  createdAt: string;
  answers: number;
  leader: { business: string | null; up: number } | null;
};
export type Answer = {
  id: string;
  body: string;
  author: string;
  mine: boolean;
  held: boolean;
  createdAt: string;
  up: number;
  down: number;
  myVote: -1 | 0 | 1;
  business: Business | null;
  businessName: string | null;
  /** How many people's answers showing here suggest this same business (D-62, 0062: each their own answer). */
  suggested: number;
};
export type Question = Omit<FeedQuestion, 'answers' | 'leader'> & { detail: string | null; answers: Answer[] };

const person = (userId: string) => ({ side: 'person' as const, userId });

/** Read as the person when signed in (their own held posts too), else as nobody (shown posts only). */
function reading<T>(env: ServerEnv, userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  return userId ? actingAs(env, person(userId), fn) : withDb(env, fn);
}

/** The main kinds of business, for a question's kind and the feed's filter. */
export async function communityKinds(env: ServerEnv): Promise<Kind[]> {
  return withDb(env, (db) =>
    db.execute<Kind>(sql`
      select slug::text as slug, name from category where parent_id is null and is_active order by sort_order, name`),
  );
}

/** The feed: newest first, each with how many answers and its most helpful one. */
export async function communityFeed(env: ServerEnv, userId: string | null, kindSlug: string | null): Promise<FeedQuestion[]> {
  const me = userId ?? '00000000-0000-0000-0000-000000000000';
  const rows = await reading(env, userId, (db) =>
    db.execute<{
      id: string;
      title: string;
      kindSlug: string | null;
      kindName: string | null;
      author: string | null;
      mine: boolean;
      status: string;
      createdAt: string;
      answers: number;
      leaderBusiness: string | null;
      leaderUp: number | null;
    }>(sql`
      select q.id, q.title, c.slug::text as "kindSlug", c.name as "kindName", reviewer_name(q.author_user_id) as author,
             q.author_user_id = ${me}::uuid as mine, q.status, q.created_at::text as "createdAt",
             (select count(*)::int from community_answer a where a.question_id = q.id and a.status = 'shown') as answers,
             top.business as "leaderBusiness", top.up as "leaderUp"
      from community_question q
      left join category c on c.id = q.category_id
      left join lateral (
        select coalesce(v.display_name, a.business_name) as business, a.up_votes as up
        from community_answer a left join vendor v on v.id = a.vendor_id and v.listing_status = 'published'
        where a.question_id = q.id and a.status = 'shown'
        order by a.up_votes - a.down_votes desc, a.up_votes desc, a.created_at limit 1) top on true
      where q.status <> 'removed' and (q.status = 'shown' or q.author_user_id = ${me}::uuid)
        and (${kindSlug}::text is null or c.slug::text = ${kindSlug})
      order by q.created_at desc
      limit 100`),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kindSlug && r.kindName ? { slug: r.kindSlug, name: r.kindName } : null,
    author: r.author ?? 'A Localites member',
    mine: r.mine,
    held: r.status === 'held',
    createdAt: r.createdAt,
    answers: r.answers,
    leader: r.answers > 0 ? { business: r.leaderBusiness, up: Number(r.leaderUp ?? 0) } : null,
  }));
}

/** One question and its answers (shown ones, and the person's own held ones), most helpful or newest first. */
export async function communityQuestion(
  env: ServerEnv,
  userId: string | null,
  id: string,
  order: 'helpful' | 'newest',
): Promise<Question | null> {
  if (!isUuid(id)) return null;
  const me = userId ?? '00000000-0000-0000-0000-000000000000';
  return reading(env, userId, async (db) => {
    const [q] = await db.execute<{
      id: string;
      title: string;
      detail: string | null;
      kindSlug: string | null;
      kindName: string | null;
      author: string | null;
      mine: boolean;
      status: string;
      createdAt: string;
    }>(sql`
      select q.id, q.title, q.detail, c.slug::text as "kindSlug", c.name as "kindName", reviewer_name(q.author_user_id) as author,
             q.author_user_id = ${me}::uuid as mine, q.status, q.created_at::text as "createdAt"
      from community_question q left join category c on c.id = q.category_id
      where q.id = ${id} and (q.status = 'shown' or (q.status = 'held' and q.author_user_id = ${me}::uuid))`);
    if (!q) return null;
    const answers = await db.execute<{
      id: string;
      body: string;
      author: string | null;
      mine: boolean;
      status: string;
      createdAt: string;
      up: number;
      down: number;
      myVote: number | null;
      slug: string | null;
      name: string | null;
      kind: string | null;
      photoPath: string | null;
      businessName: string | null;
      suggested: number;
    }>(sql`
      select a.id, a.body, reviewer_name(a.author_user_id) as author, a.author_user_id = ${me}::uuid as mine, a.status,
             a.created_at::text as "createdAt", a.up_votes as up, a.down_votes as down,
             -- Read as the person (RLS): only their own vote; signed out, none.
             (select cv.value from community_vote cv where cv.answer_id = a.id and cv.user_id = ${me}::uuid) as "myVote",
             v.slug::text as slug, v.display_name as name, top.name as kind, cp.path as "photoPath", a.business_name as "businessName",
             (select count(*)::int from community_answer b
              where b.question_id = a.question_id and (b.status = 'shown' or b.id = a.id)
                and ((a.vendor_id is not null and b.vendor_id = a.vendor_id)
                  or (a.business_name is not null and lower(b.business_name) = lower(a.business_name)))) as suggested
      from community_answer a
      left join vendor v on v.id = a.vendor_id and v.listing_status = 'published'
      left join lateral (
        select coalesce(c.parent_id, c.id) as top_id from vendor_category vc join category c on c.id = vc.category_id
        where vc.vendor_id = v.id and c.is_active order by vc.is_primary desc, c.name limit 1) pc on true
      left join category top on top.id = pc.top_id
      left join lateral (
        select m.storage_path as path from vendor_media vm join media_asset m on m.id = vm.media_asset_id
        where vm.vendor_id = v.id and vm.role in ('gallery', 'logo') and m.deleted_at is null
        order by vm.role = 'logo' desc, vm.sort_order, m.created_at limit 1) cp on true
      where a.question_id = ${id} and (a.status = 'shown' or (a.status = 'held' and a.author_user_id = ${me}::uuid))
      order by ${order === 'newest' ? sql`a.created_at desc` : sql`a.up_votes - a.down_votes desc, a.up_votes desc, a.created_at`}`);
    return {
      id: q.id,
      title: q.title,
      detail: q.detail,
      kind: q.kindSlug && q.kindName ? { slug: q.kindSlug, name: q.kindName } : null,
      author: q.author ?? 'A Localites member',
      mine: q.mine,
      held: q.status === 'held',
      createdAt: q.createdAt,
      answers: answers.map((a) => ({
        id: a.id,
        body: a.body,
        author: a.author ?? 'A Localites member',
        mine: a.mine,
        held: a.status === 'held',
        createdAt: a.createdAt,
        up: Number(a.up),
        down: Number(a.down),
        myVote: a.myVote === 1 ? 1 : a.myVote === -1 ? -1 : 0,
        business: a.slug && a.name ? { slug: a.slug, name: a.name, kind: a.kind, photo: smallPhotoUrl(env, a.photoPath), listed: true } : null,
        businessName: a.businessName,
        suggested: Number(a.suggested),
      })),
    };
  });
}

/** For suggesting a business: their favourites first, then every business listed (the owner: "your favourites first"). */
export async function businessChoices(env: ServerEnv, userId: string): Promise<{ favourites: Business[]; all: Business[] }> {
  const rows = await actingAs(env, person(userId), (db) =>
    db.execute<{ slug: string; name: string; kind: string | null; saved: boolean }>(sql`
      select v.slug::text as slug, v.display_name as name, top.name as kind,
             exists (select 1 from saved_vendor s where s.user_id = ${userId}::uuid and s.vendor_id = v.id) as saved
      from vendor v
      left join lateral (
        select coalesce(c.parent_id, c.id) as top_id from vendor_category vc join category c on c.id = vc.category_id
        where vc.vendor_id = v.id and c.is_active order by vc.is_primary desc, c.name limit 1) pc on true
      left join category top on top.id = pc.top_id
      where v.listing_status = 'published'
        -- A business can't praise itself (0061): never their own.
        and not exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId}::uuid and m.ended_at is null)
      order by v.display_name`),
  );
  const all = rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, photo: null, listed: true, saved: r.saved }));
  return { favourites: all.filter((b) => b.saved), all };
}

/** The database's refusals, as the words the person can act on. */
function refused(err: unknown): never {
  if (err instanceof CommunityRefused) throw err;
  const code = errorCode(err);
  const words = `${err instanceof Error ? err.message : ''} ${String((err as { cause?: unknown })?.cause ?? '')}`;
  if (code === '23505') throw new CommunityRefused(/community_answer_person_once_per_(business|name)/.test(words) ? 'twice' : 'gone');
  if (code === 'LP100' || code === 'LP101') {
    throw new CommunityRefused(
      /on the team of/.test(words) ? 'own' : /own answer/.test(words) ? 'ownVote' : /own business/.test(words) ? 'ownBusiness' : /own post/.test(words) ? 'ownReport' : /isn't listed/.test(words) ? 'unlisted' : 'gone',
    );
  }
  throw err;
}

async function underCap(db: Db, table: 'community_question' | 'community_answer' | 'community_report', column: string, userId: string, cap: number) {
  const [n] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${sql.raw(table)} where ${sql.raw(column)} = ${userId} and created_at > now() - interval '1 day'`);
  return (n?.n ?? 0) < cap;
}

/** Asks a question. Held for the team if the language check flags it; otherwise shown at once. */
export async function askQuestion(
  env: ServerEnv,
  userId: string,
  input: { title: string; detail: string | null; kindSlug: string | null },
): Promise<{ id: string; held: boolean }> {
  const check = await checkLanguage(env, [input.title, input.detail], { personal: true });
  const id = uuidv7();
  try {
    await actingAs(env, person(userId), async (tx) => {
      if (!(await underCap(tx, 'community_question', 'author_user_id', userId, COMMUNITY_LIMITS.questionsPerDay))) {
        throw new CommunityRefused('questions', 429);
      }
      const [kind] = input.kindSlug
        ? await tx.execute<{ id: string }>(sql`select id from category where slug = ${input.kindSlug} and parent_id is null and is_active`)
        : [];
      await tx.execute(sql`
        insert into community_question (id, author_user_id, title, detail, category_id, status, language_flag)
        values (${id}, ${userId}, ${input.title}, ${input.detail}, ${kind?.id ?? null},
                ${check.flagged ? 'held' : 'shown'}, ${check.flagged ? check.reason : null})`);
    });
  } catch (err) {
    refused(err);
  }
  return { id, held: check.flagged };
}

/** Answers a question, suggesting a business on Localites (by its address), a name they typed, or none. */
export async function answerQuestion(
  env: ServerEnv,
  userId: string,
  questionId: string,
  input: { body: string; vendorSlug: string | null; businessName: string | null },
): Promise<{ id: string; held: boolean }> {
  if (!isUuid(questionId)) throw new CommunityRefused('gone', 404);
  const check = await checkLanguage(env, [input.body, input.businessName], { personal: true });
  const id = uuidv7();
  try {
    await actingAs(env, person(userId), async (tx) => {
      if (!(await underCap(tx, 'community_answer', 'author_user_id', userId, COMMUNITY_LIMITS.answersPerDay))) {
        throw new CommunityRefused('answers', 429);
      }
      let vendorId: string | null = null;
      if (input.vendorSlug) {
        const [v] = await tx.execute<{ id: string }>(sql`select id from vendor where slug = ${input.vendorSlug} and listing_status = 'published'`);
        if (!v) throw new CommunityRefused('unlisted');
        vendorId = v.id;
      } else if (input.businessName) {
        // A typed name that's a business on Localites is that business, so the database's checks
        // (never your own, once per question) apply to it too.
        const [v] = await tx.execute<{ id: string }>(sql`
          select id from vendor where lower(display_name) = lower(${input.businessName}) and listing_status = 'published' limit 1`);
        vendorId = v?.id ?? null;
      }
      await tx.execute(sql`
        insert into community_answer (id, question_id, author_user_id, body, vendor_id, business_name, status, language_flag)
        values (${id}, ${questionId}, ${userId}, ${input.body}, ${vendorId}, ${vendorId ? null : input.businessName},
                ${check.flagged ? 'held' : 'shown'}, ${check.flagged ? check.reason : null})`);
    });
  } catch (err) {
    refused(err);
  }
  return { id, held: check.flagged };
}

/** Votes an answer up or down; the same way again takes the vote back. */
export async function voteOn(env: ServerEnv, userId: string, answerId: string, value: 1 | -1): Promise<void> {
  if (!isUuid(answerId)) throw new CommunityRefused('gone', 404);
  try {
    await actingAs(env, person(userId), async (tx) => {
      const [now] = await tx.execute<{ value: number }>(sql`
        select value from community_vote where answer_id = ${answerId} and user_id = ${userId} for update`);
      if (now?.value === value) {
        await tx.execute(sql`delete from community_vote where answer_id = ${answerId} and user_id = ${userId}`);
      } else if (now) {
        await tx.execute(sql`update community_vote set value = ${value} where answer_id = ${answerId} and user_id = ${userId}`);
      } else {
        await tx.execute(sql`insert into community_vote (answer_id, user_id, value) values (${answerId}, ${userId}, ${value})`);
      }
    });
  } catch (err) {
    refused(err);
  }
}

/** Takes the person's own question or answer down (only theirs: the database checks). */
export async function takeDownOwn(env: ServerEnv, userId: string, kind: 'question' | 'answer', id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const table = sql.raw(kind === 'question' ? 'community_question' : 'community_answer');
  const rows = await actingAs(env, person(userId), (tx) =>
    tx.execute<{ id: string }>(sql`
      update ${table} set status = 'removed', removed_by = 'author', removed_at = now()
      where id = ${id} and author_user_id = ${userId} and status <> 'removed' returning id`),
  );
  return rows.length > 0;
}

/** A report of a question or an answer, once each, for the team. */
export async function reportPost(
  env: ServerEnv,
  userId: string,
  post: { kind: 'question' | 'answer'; id: string },
  reason: ReportReason,
  details: string | null,
): Promise<void> {
  if (!isUuid(post.id)) throw new CommunityRefused('gone', 404);
  try {
    await actingAs(env, person(userId), async (tx) => {
      if (!(await underCap(tx, 'community_report', 'reporter_user_id', userId, COMMUNITY_LIMITS.reportsPerDay))) {
        throw new CommunityRefused('reports', 429);
      }
      await tx.execute(sql`
        insert into community_report (id, question_id, answer_id, reporter_user_id, reason, details)
        values (${uuidv7()}, ${post.kind === 'question' ? post.id : null}, ${post.kind === 'answer' ? post.id : null},
                ${userId}, ${reason}, ${details})`);
    });
  } catch (err) {
    if (errorCode(err) === '23505') throw new CommunityRefused('reported');
    refused(err);
  }
}

/** What a post says, for the report page (shown posts only). */
export async function postToReport(
  env: ServerEnv,
  userId: string,
  post: { kind: 'question' | 'answer'; id: string },
): Promise<{ questionId: string; words: string; author: string } | null> {
  if (!isUuid(post.id)) return null;
  const [row] = await actingAs(env, person(userId), (db) =>
    post.kind === 'question'
      ? db.execute<{ questionId: string; words: string; author: string }>(sql`
          select id as "questionId", title as words, reviewer_name(author_user_id) as author
          from community_question where id = ${post.id} and status = 'shown'`)
      : db.execute<{ questionId: string; words: string; author: string }>(sql`
          select a.question_id as "questionId", a.body as words, reviewer_name(a.author_user_id) as author
          from community_answer a join community_question q on q.id = a.question_id
          where a.id = ${post.id} and a.status = 'shown' and q.status = 'shown'`),
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------------------- The team

export type TeamPost = {
  kind: 'question' | 'answer';
  id: string;
  questionId: string;
  questionTitle: string;
  /** Whether the question is showing, so the team's page only links to one that is. */
  questionShown: boolean;
  words: string;
  business: string | null;
  author: string;
  status: 'shown' | 'held' | 'removed';
  flag: string | null;
  createdAt: string;
  reports: { id: string; reason: ReportReason; details: string | null; reporter: string; createdAt: string }[];
};

/** What waits for the team: posts the language check held, and posts with open reports. */
export async function communityQueue(env: ServerEnv, admin: Admin): Promise<TeamPost[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (db) => {
    const posts = await db.execute<Omit<TeamPost, 'reports'>>(sql`
      select 'question' as kind, q.id, q.id as "questionId", q.title as "questionTitle", q.status = 'shown' as "questionShown",
             coalesce(q.detail, '') as words,
             null::text as business, reviewer_name(q.author_user_id) as author, q.status, q.language_flag as flag, q.created_at::text as "createdAt"
      from community_question q
      where q.status = 'held' or exists (select 1 from community_report r where r.question_id = q.id and r.decision is null)
      union all
      select 'answer', a.id, q.id, q.title, q.status = 'shown', a.body, coalesce(v.display_name, a.business_name), reviewer_name(a.author_user_id),
             a.status, a.language_flag, a.created_at::text
      from community_answer a join community_question q on q.id = a.question_id left join vendor v on v.id = a.vendor_id
      where a.status = 'held' or exists (select 1 from community_report r where r.answer_id = a.id and r.decision is null)
      order by "createdAt"`);
    const reports = await db.execute<{
      id: string;
      post: string;
      reason: ReportReason;
      details: string | null;
      reporter: string | null;
      createdAt: string;
    }>(sql`
      select r.id, coalesce(r.question_id, r.answer_id) as post, r.reason, r.details, reviewer_name(r.reporter_user_id) as reporter,
             r.created_at::text as "createdAt"
      from community_report r where r.decision is null order by r.created_at`);
    return posts.map((p) => ({
      ...p,
      reports: reports
        .filter((r) => r.post === p.id)
        .map((r) => ({ id: r.id, reason: r.reason, details: r.details, reporter: r.reporter ?? 'An account since deleted', createdAt: r.createdAt })),
    }));
  });
}

/** How many posts wait for the team, for the team's menu. */
export async function countCommunityWaiting(env: ServerEnv, admin: Admin): Promise<number> {
  const [row] = await actingAs(env, { side: 'team', userId: admin.userId }, (db) =>
    db.execute<{ n: number }>(sql`
      select (select count(*) from community_question q
              where q.status = 'held' or exists (select 1 from community_report r where r.question_id = q.id and r.decision is null))
           + (select count(*) from community_answer a
              where a.status = 'held' or exists (select 1 from community_report r where r.answer_id = a.id and r.decision is null)) as n`),
  );
  return Number(row?.n ?? 0);
}

/**
 * The team's decision on a post: show it (held by the language check, or reported and fine), or
 * take it down. Its open reports are decided with it. Written to the audit log.
 */
export async function decidePost(
  env: ServerEnv,
  admin: Admin,
  post: { kind: 'question' | 'answer'; id: string },
  to: 'show' | 'remove',
  note: string | null,
): Promise<void> {
  if (!isUuid(post.id)) throw new CommunityRefused('gone', 404);
  const table = sql.raw(post.kind === 'question' ? 'community_question' : 'community_answer');
  const column = sql.raw(post.kind === 'question' ? 'question_id' : 'answer_id');
  try {
    await decide(env, admin, post, to, note, table, column);
  } catch (err) {
    // Showing an answer about a business its author has suggested here since: theirs is there already.
    if (errorCode(err) === '23505') throw new CommunityRefused('twiceTeam');
    throw err;
  }
}

async function decide(
  env: ServerEnv,
  admin: Admin,
  post: { kind: 'question' | 'answer'; id: string },
  to: 'show' | 'remove',
  note: string | null,
  table: ReturnType<typeof sql.raw>,
  column: ReturnType<typeof sql.raw>,
): Promise<void> {
  await actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [now] = await tx.execute<{ status: string; removedBy: string | null }>(sql`
      select status, removed_by as "removedBy" from ${table} where id = ${post.id} for update`);
    if (!now) throw new CommunityRefused('gone', 404);
    if (now.status === 'removed' && now.removedBy !== 'team') throw new CommunityRefused('gone');
    if (to === 'remove' && now.status !== 'removed') {
      await tx.execute(sql`update ${table} set status = 'removed', removed_by = 'team', removed_at = now() where id = ${post.id}`);
    }
    if (to === 'show' && now.status !== 'shown') {
      await tx.execute(sql`update ${table} set status = 'shown', removed_by = null, removed_at = null where id = ${post.id}`);
    }
    await tx.execute(sql`
      update community_report set decision = ${to === 'remove' ? 'removed' : 'kept'}, decided_by = ${admin.userId}, decided_at = now()
      where ${column} = ${post.id} and decision is null`);
    await audit(tx, {
      actor: admin.userId,
      action: `community_${post.kind}.${to === 'remove' ? 'removed' : 'shown'}`,
      subjectType: `community_${post.kind}`,
      subjectId: post.id,
      reason: note,
      changes: { status: { from: now.status, to: to === 'remove' ? 'removed' : 'shown' } },
      sessionRef: admin.sessionId,
    });
  });
}
