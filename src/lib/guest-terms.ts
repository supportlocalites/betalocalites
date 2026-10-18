/**
 * Guests and replies (Stage 4; D-08, D-10, E §4.6 and §5): the words the host's pages, the
 * guest's page and the tests share.
 */

export const GUEST_LIMITS = {
  name: 80,
  message: 1000,
  note: 500,
  perEvent: 300,
  partySize: 20,
  questions: 5,
  question: 200,
  answer: 500,
  updates: 20,
  update: 1000,
} as const;

export type GuestResponse = 'yes' | 'no' | 'maybe';

/** On the host's list. */
export const RESPONSE_WORDS: Record<GuestResponse, string> = { yes: 'Coming', no: 'Can’t come', maybe: 'Maybe' };

/** On the guest's own page. */
export const RESPONSE_CHOICES: Record<GuestResponse, string> = { yes: 'Yes, I’ll be there', maybe: 'Maybe', no: 'Sorry, I can’t come' };

/** Said plainly to the host, above the list. */
export const GUESTS_PROMISE =
  'Only you see your guest list. Each guest gets their own link: it shows them the invitation and their own reply, never anyone else’s. Localites never contacts your guests; you send the links from your own phone or email.';

/** What a guest sees, as the host's page says it. */
export const GUESTS_SEE =
  'Guests see the event’s name, date and times, the town, where (if you added it), your first name and your message.';

/** D-10, said to the host where they type a phone number or email. */
export const CONTACT_KEPT = 'Only to send the invitation from your phone. Phone numbers and emails are deleted 90 days after the event.';

export const GUEST_REFUSALS: Record<string, string> = {
  LP100: 'That can’t be changed.',
  LP102: 'This event was cancelled, so it can’t be changed.',
  LP161: 'Guests can’t be added once the event is over.',
  LP162: 'An event can have up to 300 guests.',
  LP163: 'Phone numbers and emails aren’t kept after 90 days.',
  LP164: 'Replies are closed: the event is over.',
  LP165: 'How many are coming? From 1 to 20.',
  LP172: 'An invitation can ask up to 5 questions.',
  LP173: 'An event can have up to 20 updates. Remove an old one first.',
  LP174: 'That reply is already matched to a guest.',
  LP175: 'Please write your name.',
  LP176: 'This invitation has had all the replies it can take. Please ask your host.',
  question: 'Write the question.',
  questionTooLong: 'Please keep the question under 200 characters.',
  update: 'Write the update.',
  updateTooLong: 'Please keep the update under 1,000 characters.',
  answerTooLong: 'Please keep each answer under 500 characters.',
  yourName: 'Please write your name.',
  noBrowserKey: 'Please open the invitation link again, then reply.',
  name: 'Write the guest’s name.',
  nameTooLong: 'Please keep the name under 80 characters.',
  phone: 'That doesn’t look like a phone number.',
  email: 'That doesn’t look like an email address.',
  messageTooLong: 'Please keep your message under 1,000 characters.',
  response: 'Choose yes, maybe or no.',
  partySize: 'How many of you are coming? From 1 to 20.',
  noteTooLong: 'Please keep your note under 500 characters.',
  noKey: 'Invitation links aren’t switched on yet. Please try again later.',
};

/** The words a host sends with the group link (they can change them in their own app). */
export function groupShareText(title: string, date: string, link: string): string {
  return `You’re invited to ${title} on ${date}. Please let me know if you can come: ${link}`;
}

/** Said to the host beside the group link (E §5). */
export const GROUP_LINK_SAYS =
  'One link for a group chat, a social post or a printed invitation. Anyone with it can reply, giving their name; they never see anyone else’s reply. You match each reply to your guest list with one tap. Switch it off or make a new one at any time; the old one stops at once.';

/** The words a host sends with a guest's link (they can change them in their own app). */
export function shareText(guest: string, title: string, date: string, link: string): string {
  return `Hi ${guest}, you’re invited to ${title} on ${date}. Please let me know if you can come: ${link}`;
}
