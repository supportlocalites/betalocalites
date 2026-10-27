/** Community's dates, counts and refusals, in plain words (D-62). */
export const communityDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', timeZone: 'America/Toronto' }).format(new Date(iso));
export const answersWords = (n: number) => `${n} ${n === 1 ? 'answer' : 'answers'}`;

/**
 * Why something wasn't posted. Pages are sent back with a code (?problem=), never the words, so a
 * link can't make the site say anything else.
 */
export const COMMUNITY_PROBLEMS = {
  title: 'A question is 10 to 140 characters.',
  detail: 'More detail is up to 600 characters.',
  body: 'An answer is 10 to 600 characters.',
  name: 'A business’s name is 2 to 80 characters.',
  notFound: 'We couldn’t find that business on Localites. Choose it from the list, or type its name under “Not on Localites?”.',
  chooseOne: 'Choose one business: a favourite, one from Localites, or a name you type.',
  tooFast: 'That was quick. Please wait a moment and try again.',
  questions: 'That’s a lot of questions for one day. Please ask more tomorrow.',
  answers: 'That’s a lot of answers for one day. Please add more tomorrow.',
  reports: 'That’s a lot of reports for one day. Our team will look at the ones you’ve sent.',
  twice: 'You’ve already suggested that business here. Take your answer down first to write it again.',
  twiceTeam: 'This person already has an answer showing about that business here, so this one can’t be shown too. Take it down instead.',
  own: 'You can’t suggest a business you’re on the team of.',
  ownVote: 'You can’t vote on your own answer.',
  ownBusiness: 'You can’t vote on an answer about a business you’re on the team of.',
  ownReport: 'You can’t report your own post.',
  reported: 'You’ve already reported this. Our team will look at it.',
  unlisted: 'That business isn’t listed on Localites at the moment.',
  gone: 'That isn’t possible any more. Please reload the page.',
} as const;
export type CommunityProblem = keyof typeof COMMUNITY_PROBLEMS;
export const problemWords = (code: string | null) =>
  code && Object.hasOwn(COMMUNITY_PROBLEMS, code) ? COMMUNITY_PROBLEMS[code as CommunityProblem] : null;

export const COMMUNITY_LIMITS = {
  title: { min: 10, max: 140 },
  detail: 600,
  body: { min: 10, max: 600 },
  businessName: { min: 2, max: 80 },
  reportDetails: 500,
  questionsPerDay: 5,
  answersPerDay: 20,
  reportsPerDay: 10,
} as const;

export const REPORT_REASONS = {
  rude: 'Rude, hateful or unkind',
  untrue: 'Not true, or misleading',
  spam: 'Spam or nonsense',
  self_promotion: 'A business praising itself',
  personal: 'Shares someone’s private details',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
