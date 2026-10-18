/**
 * The language check's word list (D-50): strong swearing and slurs, each as a whole word (so
 * "Scunthorpe", "assessment" and "shiitake" never match). A match only holds the words for the
 * team to read; it never refuses or deletes anything, so a word that's sometimes innocent can
 * stay. Mild words ("hell", "damn") and words with everyday meanings ("cock", "pussy" for a
 * rooster or a cat) are left out. Lower case, without accents; see normalise() in
 * moderation.server.ts for how text is compared (look-alike numbers and symbols included).
 */
export const OFFENSIVE_WORDS: readonly string[] = [
  // Swearing.
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckin', 'fuckoff', 'motherfucker', 'motherfuckers',
  'motherfucking', 'fck', 'fcking', 'fuk', 'fuking', 'fking', 'wtf', 'stfu',
  'shit', 'shits', 'shitty', 'shitting', 'shithead', 'shitheads', 'bullshit', 'horseshit', 'dipshit',
  'cunt', 'cunts', 'twat', 'twats', 'bitch', 'bitches', 'bitchy', 'sonofabitch', 'bastard', 'bastards',
  'asshole', 'assholes', 'arsehole', 'arseholes', 'jackass', 'dumbass', 'dickhead', 'dickheads',
  'whore', 'whores', 'slut', 'sluts', 'skank', 'wanker', 'wankers', 'prick', 'pricks',
  // Slurs (race, religion, origin, sexuality, gender identity, disability).
  'nigger', 'niggers', 'nigga', 'niggas', 'negro', 'coon', 'coons', 'spic', 'spics', 'wetback', 'wetbacks', 'beaner',
  'beaners', 'chink', 'chinks', 'gook', 'gooks', 'jap', 'japs', 'kike', 'kikes', 'paki', 'pakis', 'raghead',
  'ragheads', 'towelhead', 'towelheads', 'redskin', 'redskins', 'squaw', 'gypsy', 'gypped', 'injun',
  'faggot', 'faggots', 'fag', 'fags', 'dyke', 'dykes', 'tranny', 'trannies', 'shemale',
  'retard', 'retards', 'retarded', 'spaz', 'mongoloid',
  // Threats and hate, as single words.
  'kys', 'nazi', 'nazis',
];
