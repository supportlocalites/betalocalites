/**
 * The language check's word list (D-50): strong swearing and slurs, each as a whole word (so
 * "Scunthorpe", "assessment" and "shiitake" never match). A match only holds the words for the
 * team to read; it never refuses or deletes anything, so a word that's sometimes innocent can
 * stay, but a held save waits for the team, so words with everyday meanings are left out: mild
 * words ("hell", "damn"), and "cock", "pussy", "prick", "coon", "spic", "dyke", "gypsy", "jackass",
 * "redskin", "tranny", "negro", "nazi" (a rooster, a cat, pricking dough, Maine Coon cats, spic and
 * span, Van Dyke, gypsy jazz, a farm's jackass, redskin potatoes, a transmission, Rio Negro).
 * Lower case, without accents; see normalise() in moderation.server.ts for how text is compared
 * (look-alike numbers and symbols included).
 */
export const OFFENSIVE_WORDS: readonly string[] = [
  // Swearing.
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckin', 'fuckoff', 'motherfucker', 'motherfuckers',
  'motherfucking', 'fck', 'fcking', 'fuk', 'fuking', 'fking', 'wtf', 'stfu',
  'shit', 'shits', 'shitty', 'shitting', 'shithead', 'shitheads', 'bullshit', 'horseshit', 'dipshit',
  'cunt', 'cunts', 'twat', 'twats', 'bitch', 'bitches', 'bitchy', 'sonofabitch', 'bastard', 'bastards',
  'asshole', 'assholes', 'arsehole', 'arseholes', 'dumbass', 'dickhead', 'dickheads',
  'whore', 'whores', 'slut', 'sluts', 'skank', 'wanker', 'wankers',
  // Slurs (race, religion, origin, sexuality, gender identity, disability).
  'nigger', 'niggers', 'nigga', 'niggas', 'wetback', 'wetbacks', 'beaner', 'beaners', 'chink', 'chinks', 'gook',
  'gooks', 'jap', 'japs', 'kike', 'kikes', 'paki', 'pakis', 'raghead', 'ragheads', 'towelhead', 'towelheads',
  'squaw', 'injun',
  'faggot', 'faggots', 'fag', 'fags', 'shemale',
  'retard', 'retards', 'retarded', 'spaz', 'mongoloid',
  // Threats, as single words.
  'kys',
];
