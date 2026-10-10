import { sql } from 'drizzle-orm';
import approved from '../../emails/claim-approved.txt?raw';
import declined from '../../emails/claim-declined.txt?raw';
import received from '../../emails/claim-received.txt?raw';
import team from '../../emails/claim-team.txt?raw';
import { uuidv7 } from '@/lib/ids.mjs';
import { withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import type { ServerEnv } from './env';

/**
 * Emails written as plain text files in emails/ (checked by `npm run check:words`).
 * The first line is "Subject: …"; {{name}} placeholders are filled in here.
 */
const TEMPLATES = { approved, declined, received, team } as const;
export type TemplateName = keyof typeof TEMPLATES;

export function renderEmail(name: TemplateName, values: Record<string, string>): { subject: string; text: string } {
  // Values are one line each, so nothing typed can add lines to the subject or the email.
  const filled = TEMPLATES[name].replace(/\{\{(\w+)\}\}/g, (_, key: string) => (values[key] ?? '').replace(/[\r\n]+/g, ' '));
  const [first, ...rest] = filled.split('\n');
  return { subject: (first ?? '').replace(/^Subject:\s*/, '').trim(), text: rest.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n') };
}

/**
 * Emails one person and records it honestly in `notification` (A §3): "sent" only once
 * the provider accepted it, "failed" with the reason otherwise (including "not set up").
 */
export async function emailPerson(
  env: ServerEnv,
  to: { userId: string; email: string },
  kind: 'claim_received' | 'claim_decision',
  subject: { type: string; id: string },
  content: { subject: string; text: string },
): Promise<void> {
  const id = uuidv7();
  await withDb(env, (db) =>
    db.execute(sql`insert into notification (id, user_id, kind, subject_type, subject_id)
                   values (${id}, ${to.userId}, ${kind}, ${subject.type}, ${subject.id})`),
  );
  const result = await sendEmail(env, { to: to.email, ...content, replyTo: TEAM_ADDRESS });
  await withDb(env, (db) =>
    result.sent
      ? db.execute(sql`update notification set status = 'sent', sent_at = now() where id = ${id}`)
      : db.execute(sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = ${id}`),
  );
}

/** Emails the team (D-11). The admin page is the record; a failed team email is logged only. */
export async function emailTeam(env: ServerEnv, content: { subject: string; text: string }): Promise<void> {
  const result = await sendEmail(env, { to: TEAM_ADDRESS, ...content });
  if (!result.sent && env.RESEND_API_KEY) console.error('team email not sent:', result.reason);
}
