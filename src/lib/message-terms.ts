/**
 * Messages (Stage 2B; D-13, D-17, E §4.3 and §6): the words both sides see, in one place so
 * the pages, emails and tests agree.
 */

export const MESSAGE_LIMITS = {
  body: 5000,
  /** New conversations one person may start in a day (keeps a business's inbox free of spam). */
  conversationsPerDay: 20,
  /** Messages one person may send in a day, across all conversations. */
  messagesPerDay: 200,
} as const;

/** Files in conversations (migration 0028): one photo or PDF per message. */
export const FILE_LIMITS = {
  /** A photo, after the browser has shrunk it (as business photos). */
  photoBytes: 1024 * 1024,
  photoSide: 2048,
  /** A PDF, as chosen (Localites doesn't change it). */
  pdfBytes: 4 * 1024 * 1024,
  /** Files one person may send in a day, across all conversations. */
  perDay: 20,
  /** All conversation files together (the free plan's 1 GB is shared with business photos). */
  siteBytes: 700 * 1024 * 1024,
  name: 120,
} as const;

/** Every conversation's footer (E §6, ADR-018). */
export const NO_PAYMENTS_IN_CONVERSATION = 'Localites doesn’t process payments. Arrange payment directly with each other.';

/** E §6: we can't control what people write, so we say so. */
export const SHARE_CAREFULLY = 'Only share what’s needed to plan your event. Never send passwords or card numbers.';

/**
 * How an open conversation looks for new messages (D-13: about every 15 seconds while you're
 * there). Each look is one small read; the page reloads only when something changed. Quiet
 * looks slow down, and stop while you're away (the free plans count every request).
 */
export const REFRESH = {
  /** The first look, and the next one after anything new or anything you do on the page. */
  fastestSeconds: 15,
  /** Each quiet look waits twice as long as the last, up to this. */
  slowestSeconds: 120,
  /** No looks after this long without you touching the page; it looks again when you do. */
  idleMinutes: 10,
} as const;

/** Why someone reports a conversation or a message (E §4.3). */
export const REPORT_REASONS = {
  spam: 'Spam',
  harassment: 'Harassment or abuse',
  scam_or_fraud: 'A scam or fraud',
  inappropriate: 'Something inappropriate',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** After reporting: what happens next, plainly. */
export const REPORT_SENT = 'Thanks. Our team will look at it. They can read this conversation because you reported it.';

export const MESSAGE_REFUSALS = {
  LP100: 'That can’t be changed.',
  LP108: 'This is your own business.',
  LP109: 'That change isn’t possible right now.',
  LP140: 'This business isn’t on Localites right now, so it can’t receive messages.',
  LP142: 'Businesses can reply, but the person starts the conversation.',
  LP143: 'This conversation is blocked, so no new messages can be sent.',
  LP144: 'This business isn’t listed on Localites at the moment, so messages to it are paused.',
  LP145: 'Your business isn’t listed on Localites at the moment, so messages are paused until it is.',
  LP146: 'This person has left Localites, so no new messages can be sent.',
  LP147: 'Write a message or add a file first.',
  empty: 'Write a message first.',
  tooLong: 'Please keep your message under 5,000 characters.',
  conversationsPerDay: 'You’ve started a lot of conversations today. Please try again tomorrow.',
  messagesPerDay: 'You’ve sent a lot of messages today. Please try again tomorrow.',
  filesPerDay: 'You’ve sent a lot of files today. Please try again tomorrow.',
  filesFull: 'Sending files is paused for now. Please send your message without it, or try again later.',
  filesOff: 'Sending files isn’t switched on yet. Please send your message without it.',
  fileNotSaved: 'The file couldn’t be saved just now. Please try again in a few minutes.',
  fileType: 'Please choose a photo or a PDF.',
  photoTooBig: 'That photo is too large. Please choose a smaller one (under 1 MB and 2048 pixels a side).',
  photoTurned: 'That photo is stored on its side. Please turn it in your photo app and save it, then try again.',
  pdfTooBig: 'That PDF is too large. Please choose one under 4 MB.',
} as const;
