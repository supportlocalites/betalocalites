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

/** Every conversation's footer (E §6, ADR-018). */
export const NO_PAYMENTS_IN_CONVERSATION = 'Localites doesn’t process payments. Arrange payment directly with each other.';

/** E §6: we can't control what people write, so we say so. */
export const SHARE_CAREFULLY = 'Only share what’s needed to plan your event. Never send passwords or card numbers.';

/** How often an open conversation looks for new messages (D-13: about every 15 seconds). */
export const REFRESH_SECONDS = 15;

export const MESSAGE_REFUSALS = {
  LP100: 'That can’t be changed.',
  LP108: 'This is your own business.',
  LP109: 'That change isn’t possible right now.',
  LP140: 'This business isn’t on Localites right now, so it can’t receive messages.',
  LP142: 'Businesses can reply, but the person starts the conversation.',
  LP143: 'This conversation is blocked, so no new messages can be sent.',
  empty: 'Write a message first.',
  tooLong: 'Please keep your message under 5,000 characters.',
  conversationsPerDay: 'You’ve started a lot of conversations today. Please try again tomorrow.',
  messagesPerDay: 'You’ve sent a lot of messages today. Please try again tomorrow.',
} as const;
