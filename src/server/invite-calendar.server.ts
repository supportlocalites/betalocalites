import { type CalendarEvent } from '@/lib/calendar';
import type { Invitation } from './guests.server';

/** The guest's event as a calendar sees it: never their invitation link (D-49 page, Stage 4). */
export function calendarEvent(i: Invitation): CalendarEvent {
  const host = i.host ?? 'your host';
  return {
    title: i.title,
    date: i.date,
    startTime: i.startTime,
    endTime: i.endTime,
    timezone: i.timezone,
    location: i.where ? `${i.where}, ${i.town}` : i.town,
    details: [i.message, `Invited by ${host}, through Localites.`].filter(Boolean).join('\n\n'),
  };
}
