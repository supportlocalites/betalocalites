import { data } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { fileResponse } from '@/server/conversation-files.server';
import { found } from '@/server/plan-pages.server';
import { reportFile } from '@/server/reports.server';
import type { Route } from './+types/report-file';

/**
 * A photo or PDF in a reported conversation (X13, migration 0028), for the Localites team:
 * only through the report, and only while it's there or kept for the report. The database
 * writes each look to the audit log with the report.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id) || !isUuid(params.fileId)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const file = await found(reportFile(env, context.get(adminContext), params.id, params.fileId));
  return fileResponse(file.body, file);
}
