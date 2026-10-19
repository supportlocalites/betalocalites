import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { REPORT_REASONS, type ReportReason } from '@/lib/message-terms';
import { REPORT_OUTCOMES } from '@/lib/review-terms';
import { type Acting, actingAs, errorCode, PlanNotFound, PlanRefused } from './acting.server';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { emailPerson, renderEmail } from './email-templates.server';
import { readPrivateFile } from './photo-store.server';
import type { ServerEnv } from './env';
import { asTeam, talked } from './messages.server';

/**
 * Reports (Stage 2B part 2; E §4.3 and §6, migration 0024): either side of a conversation
 * reports it, or one message in it, to the Localites team, which reads it only through the
 * report (each look logged) and can hide the message, block the conversation, and close the
 * report with a note. Nobody else reads reports.
 */

export type ReportInput = { messageId: string | null; reason: ReportReason; details: string | null };

/** What the report page shows: who it's with, and the message being reported, if one. */
export type ReportTarget = { withName: string; message: { id: string; body: string } | null };

async function target(tx: Db, conversationId: string, messageId: string | null, side: 'person' | 'business') {
  const [c] = await tx.execute<{ withName: string }>(sql`
    select case when ${side} = 'person' then v.display_name else u.display_name end as "withName"
    from conversation c join vendor v on v.id = c.vendor_id join app_user u on u.id = c.consumer_user_id
    where c.id = ${conversationId}`);
  if (!c) throw new PlanNotFound();
  let message: ReportTarget['message'] = null;
  if (messageId) {
    const [m] = await tx.execute<{ id: string; body: string; removed: boolean; hidden: boolean }>(sql`
      select id, body, removed_at is not null as removed, hidden_by_team_at is not null as hidden
      from message where id = ${messageId} and conversation_id = ${conversationId}`);
    if (!m) throw new PlanNotFound();
    message = { id: m.id, body: m.removed ? 'Message removed' : m.hidden ? 'Hidden by Localites' : m.body };
  }
  return { withName: c.withName, message };
}

/** The person's side: their own conversation (anyone else's is "not found"). */
export function personReportTarget(
  env: ServerEnv,
  userId: string,
  conversationId: string,
  messageId: string | null,
): Promise<ReportTarget> {
  return talked(actingAs(env, { side: 'person', userId }, (tx) => target(tx, conversationId, messageId, 'person')));
}

/** The business's side: anyone on its team. */
export function businessReportTarget(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  messageId: string | null,
): Promise<ReportTarget & { vendorId: string }> {
  return asTeam(env, userId, slug, async (tx, b) => ({ ...(await target(tx, conversationId, messageId, 'business')), vendorId: b.id }));
}

/** Report emails to the team in a day, across the site (migration 0045); the rest wait on the list. */
const REPORT_EMAILS_PER_DAY = 20;

/**
 * Saves a report, then emails the team (the report is on the team's list either way) and
 * records whether that email went. After 20 report emails in a day, no more are sent that day
 * (they stay "pending"), so sign-in codes keep their share of the day's emails.
 */
export async function sendReport(
  env: ServerEnv,
  acting: Acting,
  conversationId: string,
  input: ReportInput,
  siteUrl: string,
): Promise<string> {
  const id = uuidv7();
  const info = await talked(
    actingAs(env, acting, async (tx) => {
      await tx.execute(sql`
        insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, message_id, reason, details)
        values (${id}, ${acting.userId}, ${acting.side === 'person' ? 'consumer' : 'vendor'}, ${conversationId}, ${input.messageId},
                ${input.reason}, ${input.details})`);
      const [row] = await tx.execute<{ business: string; person: string; reporter: string }>(sql`
        select v.display_name as business, u.display_name as person, r.display_name as reporter
        from conversation c join vendor v on v.id = c.vendor_id join app_user u on u.id = c.consumer_user_id
        join app_user r on r.id = ${acting.userId}
        where c.id = ${conversationId}`);
      return row;
    }),
  );
  if (!info) return id;
  // The report is saved: if the count can't be read, the email still goes.
  const today = await withDb(env, (db) => db.execute<{ n: number }>(sql`select report_emails_today() as n`)).catch(() => []);
  if ((today[0]?.n ?? 0) >= REPORT_EMAILS_PER_DAY) return id;
  const result = await sendEmail(env, {
    to: TEAM_ADDRESS,
    ...renderEmail('reportTeam', {
      reporter: info.reporter,
      side: acting.side === 'person' ? 'the customer' : `on ${info.business}'s team`,
      what: input.messageId ? 'a message' : 'the conversation',
      person: info.person,
      business: info.business,
      reason: REPORT_REASONS[input.reason],
      details: input.details ?? 'none',
      reportUrl: `${siteUrl}/admin/reports/${id}`,
    }),
  });
  try {
    await actingAs(env, acting, (tx) =>
      tx.execute(sql`update moderation_report set team_email_status = ${result.sent ? 'sent' : 'failed'} where id = ${id}`),
    );
  } catch (err) {
    console.error('report email outcome not recorded', err instanceof Error ? err.message : err);
  }
  return id;
}

// ------------------------------------------------------------------ a conversation the person deleted (D-54)

export type DeletedConversation = { id: string; person: string; deletedAt: string; reported: boolean };

/** For 30 days after a person deletes a conversation, the business is told, and can report it (without reading it). */
export async function deletedConversations(env: ServerEnv, userId: string, slug: string): Promise<DeletedConversation[]> {
  return asTeam(env, userId, slug, async (tx) => [
    ...(await tx.execute<DeletedConversation>(sql`
      select conversation_id as id, person, deleted_at::text as "deletedAt", reported from deleted_conversations_for_business()`)),
  ]);
}

/** The business reports a conversation the person deleted; the team is emailed as for any report. */
export async function reportDeleted(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  input: Omit<ReportInput, 'messageId'>,
  siteUrl: string,
): Promise<void> {
  const made = await talked(
    asTeam(env, userId, slug, async (tx, b) => {
      const [row] = await tx.execute<{ id: string; person: string; business: string }>(sql`
        select report_id as id, person, business from report_deleted_conversation(${conversationId}::uuid, ${input.reason}, ${input.details})`);
      const [me] = await tx.execute<{ name: string }>(sql`select display_name as name from app_user where id = ${userId}`);
      return row ? { ...row, reporter: me?.name ?? 'Someone', vendorId: b.id } : null;
    }),
  );
  if (!made) throw new PlanNotFound();
  const today = await withDb(env, (db) => db.execute<{ n: number }>(sql`select report_emails_today() as n`)).catch(() => []);
  if ((today[0]?.n ?? 0) >= REPORT_EMAILS_PER_DAY) return;
  const result = await sendEmail(env, {
    to: TEAM_ADDRESS,
    ...renderEmail('reportTeam', {
      reporter: made.reporter,
      side: `on ${made.business}'s team`,
      what: 'a conversation the customer has since deleted',
      person: made.person,
      business: made.business,
      reason: REPORT_REASONS[input.reason],
      details: input.details ?? 'none',
      reportUrl: `${siteUrl}/admin/reports/${made.id}`,
    }),
  });
  try {
    await actingAs(env, { side: 'business', userId, vendorId: made.vendorId }, (tx) =>
      tx.execute(sql`update moderation_report set team_email_status = ${result.sent ? 'sent' : 'failed'} where id = ${made.id}`),
    );
  } catch (err) {
    console.error('report email outcome not recorded', err instanceof Error ? err.message : err);
  }
}

// ------------------------------------------------------------------ the team (X13)

export type ReportRow = {
  id: string;
  reason: ReportReason;
  details: string | null;
  reporter: string;
  reporterSide: 'consumer' | 'vendor';
  business: string;
  person: string;
  aboutMessage: boolean;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: string;
  emailStatus: 'pending' | 'sent' | 'failed';
};

const ROW = sql`
  select r.id, r.reason, r.details, ru.display_name as reporter, r.reporter_side as "reporterSide", v.display_name as business,
         pu.display_name as person, r.message_id is not null as "aboutMessage", r.status, r.created_at::text as "createdAt",
         r.team_email_status as "emailStatus"
  from moderation_report r
  join conversation c on c.id = r.conversation_id
  join vendor v on v.id = c.vendor_id
  join app_user pu on pu.id = c.consumer_user_id
  join app_user ru on ru.id = r.reporter_user_id`;

/** The reports list: open ones (oldest first), or all (newest first). Who reported what, never the messages. */
export async function listReports(env: ServerEnv, admin: Admin, show: 'open' | 'all'): Promise<ReportRow[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const rows = await tx.execute<ReportRow>(
      show === 'open'
        ? sql`${ROW} where r.status = 'open' order by r.created_at limit 300`
        : sql`${ROW} order by r.created_at desc limit 300`,
    );
    return [...rows];
  });
}

export type ReportDetail = ReportRow & {
  conversationStatus: string;
  decisionNote: string | null;
  messages: {
    id: string;
    side: 'consumer' | 'vendor';
    author: string;
    body: string;
    createdAt: string;
    removed: boolean;
    hidden: boolean;
    reported: boolean;
    /** What it said before its author changed it (M2, D-54), oldest first. */
    versions: { body: string; replacedAt: string }[];
    /** The photo or PDF sent with it (migration 0028); gone: deleted, not kept for the report. */
    file: { id: string; name: string; isPhoto: boolean; size: number; gone: boolean } | null;
  }[];
};

/** One report and its whole conversation (reading it is logged by the database, with the report). */
export async function reportDetail(env: ServerEnv, admin: Admin, reportId: string): Promise<ReportDetail> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [row] = await tx.execute<ReportRow & { conversationStatus: string; decisionNote: string | null }>(sql`
      select x.*, c.status as "conversationStatus", r.decision_note as "decisionNote"
      from (${ROW}) x join moderation_report r on r.id = x.id join conversation c on c.id = r.conversation_id
      where x.id = ${reportId}`);
    if (!row) throw new PlanNotFound();
    const messages = await tx.execute<Omit<ReportDetail['messages'][number], 'file' | 'versions'>>(sql`
      select message_id as id, author_side as side, author_name as author, body, created_at::text as "createdAt", removed, hidden, reported
      from reported_conversation_for_team(${reportId}::uuid)`);
    const files = await tx.execute<{ id: string; messageId: string; name: string; type: string; size: number; gone: boolean }>(sql`
      select file_id as id, message_id as "messageId", file_name as name, mime_type as type, byte_size as size, gone
      from reported_conversation_files_for_team(${reportId}::uuid)`);
    const byMessage = new Map(
      files.map((f) => [f.messageId, { id: f.id, name: f.name, isPhoto: f.type !== 'application/pdf', size: f.size, gone: f.gone }]),
    );
    const edits = await tx.execute<{ messageId: string; body: string; replacedAt: string }>(sql`
      select message_id as "messageId", body, replaced_at::text as "replacedAt" from reported_message_versions_for_team(${reportId}::uuid)`);
    const versions = new Map<string, { body: string; replacedAt: string }[]>();
    for (const e of edits) versions.set(e.messageId, [...(versions.get(e.messageId) ?? []), { body: e.body, replacedAt: e.replacedAt }]);
    return {
      ...row,
      messages: messages.map((m) => ({ ...m, file: byMessage.get(m.id) ?? null, versions: versions.get(m.id) ?? [] })),
    };
  });
}

/** The team's decisions on a report: hide its message, block or unblock, close with a note. */
export async function decideReport(
  env: ServerEnv,
  admin: Admin,
  reportId: string,
  decision: { kind: 'hide' } | { kind: 'block' | 'unblock' } | { kind: 'close'; outcome: 'actioned' | 'dismissed'; note: string },
): Promise<Closed | null> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx): Promise<Closed | null> => {
    if (decision.kind === 'hide') {
      try {
        await tx.execute(sql`select team_hide_reported_message(${reportId}::uuid)`);
      } catch (err) {
        // Its author removed it already: nobody sees its words, so there's nothing to hide.
        if (errorCode(err) === 'LP109') throw new PlanRefused('Its author has already removed that message, so nobody sees it.');
        throw err;
      }
    } else if (decision.kind === 'block' || decision.kind === 'unblock') {
      await tx.execute(sql`select team_block_reported(${reportId}::uuid, ${decision.kind === 'block'})`);
    } else if (decision.kind === 'close') {
      const [done] = await tx.execute<{ reporterId: string; other: string }>(sql`
        update moderation_report x set status = ${decision.outcome}, decision_note = ${decision.note}
        from conversation c join vendor v on v.id = c.vendor_id
        where x.id = ${reportId} and x.status = 'open' and c.id = x.conversation_id
        returning x.reporter_user_id as "reporterId",
                  case when x.reporter_side = 'consumer' then v.display_name else reviewer_name(c.consumer_user_id) end as other`);
      if (!done) throw new PlanNotFound();
      await audit(tx, {
        actor: admin.userId,
        action: `moderation_report.${decision.outcome}`,
        subjectType: 'moderation_report',
        subjectId: reportId,
        reason: decision.note,
        sessionRef: admin.sessionId,
      });
      return { reporterId: done.reporterId, other: done.other, outcome: decision.outcome };
    }
    return null;
  });
}

/** A closed report: who sent it, and who it was about, as they knew them. */
type Closed = { reporterId: string; other: string; outcome: 'actioned' | 'dismissed' };

/** The person who sent the report is told the outcome, never the team's note (M7, D-54). */
export async function emailReportOutcome(env: ServerEnv, reportId: string, closed: Closed): Promise<void> {
  const [to] = await withDb(env, (db) =>
    db.execute<{ email: string; name: string }>(sql`
      select email::text as email, coalesce(given_name, display_name) as name from app_user where id = ${closed.reporterId} and deleted_at is null`),
  );
  if (!to) return;
  const outcome = (closed.outcome === 'actioned' ? REPORT_OUTCOMES.conversationActioned : REPORT_OUTCOMES.conversationDismissed)(closed.other);
  await emailPerson(
    env,
    { userId: closed.reporterId, email: to.email },
    'report_outcome',
    { type: 'moderation_report', id: reportId },
    renderEmail('reportOutcome', { name: to.name, outcome }),
  );
}

/** One file of a reported conversation, for the team (each look logged by the database, with the report). */
export async function reportFile(env: ServerEnv, admin: Admin, reportId: string, fileId: string) {
  const [f] = await actingAs(env, { side: 'team', userId: admin.userId }, (tx) =>
    tx.execute<{ path: string; type: string; name: string }>(sql`
      select storage_path as path, mime_type as type, file_name as name from team_reported_file(${reportId}::uuid, ${fileId}::uuid)`),
  ).catch((err: unknown) => {
    if (errorCode(err) === 'LP101') return [];
    throw err;
  });
  if (!f) throw new PlanNotFound();
  const body = await readPrivateFile(env, f.path);
  if (!body) throw new PlanNotFound();
  return { body, type: f.type, name: f.name };
}
