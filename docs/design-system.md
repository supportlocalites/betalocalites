# Localites Design System (direction G)

**Status:** Adopted (D-21, 10 October 2026).
**Last updated:** 2026-10-10

This is how Localites looks and behaves, on phones and on computers. It's taken from
mockup **G** ([design archive](./design/README.md)). The build follows it; when it and a
mockup disagree, this document wins and the mockup is updated.

**One website, every screen size.** Localites is a single website that adapts to the
screen. There's no separate phone app or desktop app. Every page is one page with a phone
arrangement and a desktop arrangement, built from the same parts. A change to a colour, a
font, a button or a card is made once and appears everywhere, at every size.

---

## 1. Rules that make "change once, update everywhere" true

1. **One settings file for the look.** All colours, fonts, sizes, spacing and corner
   shapes are defined once, as named settings (design tokens, §2–§5). Nothing else in
   the code may use a raw colour or font. An automated check rejects any that does.
2. **One set of building blocks.** Every button, card, tag, message and menu is a shared
   component (§6). Screens are assembled from them and never restyle them locally.
3. **Phone first, then wider.** Each screen is written for a 390px phone first, then
   given extra room at 768px (tablet) and 1200px (desktop) (§8).
4. **Same page, same address.** A page has one address (URL) whether it's opened on a
   phone or a computer, so shared links always work.
5. **Checked at three sizes on every change.** Phone (390 × 844), tablet (768 × 1024)
   and desktop (1440 × 900); see [testing-strategy.md](./testing-strategy.md).
6. **Installable later, at no cost.** The website can be made installable (an icon on a
   phone's home screen or a computer's dock) without a second codebase. App-store apps
   are out of scope (separate code, yearly fees).

## 2. Colour

| Token | Value | Used for |
|---|---|---|
| `ground` | `#F7F5F1` (ivory) | Page background |
| `surface` | `#FBFAF8` | Cards, inputs, panels, the inbox |
| `ink` | `#141414` | Text, primary buttons, active tab |
| `ink-soft` | `#3D3935` | The italic line on Welcome |
| `muted` | `#6B655E` | Secondary text, small-capital labels |
| `line` | `#DCD6CE` | Borders and hairline rules |
| `line-soft` | `#E7E2DA` | Dividers inside lists |
| `tint` | `#EDE8E1` | Your own messages, updates you've sent |
| `gold` | `#B8955A` | **Lines and outlines only**: photo frames, the Welcome frame, the rule under a title, the Booked tag, file cards, secondary button outline |
| `on-ink` | `#F7F5F1` | Text on black |
| Photo placeholders | `#E5DFD6` `#DDD6CB` `#E9E4DC` `#D3CCC1` | While a photo loads |

**Gold is never used for text, icons or fills**, and never on its own to say something
(it fails contrast). Body text on `ground` or `surface` must reach a 4.5:1 contrast ratio.
`muted` on `ground` is about 5.3:1.

## 3. Type

Two typefaces, both free (SIL Open Font License), **served with the site itself** rather
than from Google, which is faster and sends no visitor data to a third party.

- **Playfair Display** (600, 700; italic 500): the Localites name, page titles,
  business names, numbers. Italic for soft accents ("In thirty-six days.", "See what
  your community has to offer…").
- **Jost** (400, 500, 600): everything else.

| Role | Phone | Desktop | Notes |
|---|---|---|---|
| Welcome name ("Localites.") | 72 / 700 | 64–132, scales with width | Letter-spacing −0.02em |
| Title 1 (page title) | 30 / 600 | 44 / 600 | Playfair |
| Title 2 | 26 / 600 | 30 / 600 | Playfair |
| Title 3 (business names) | 18 / 600 | 19 / 600 | Playfair |
| Body | 15 / 400 | 16 / 400 | Jost, line height 1.55 |
| Small | 13 | 14 | Jost |
| Label | 10.5 / 600 | 11 / 600 | Jost, capitals, letter-spacing 0.2em, `muted` |
| Button | 13–14 / 500 | 13 / 500 | Jost, capitals, letter-spacing 0.16–0.18em |

## 4. Space

Base unit 4px. Common steps: 4, 8, 12, 14, 16, 20, 24, 28, 32, 48, 56.
Phone side margins 16–24px. Desktop content sits in a centred column up to 1200px wide
with 32px margins.

## 5. Shape

| Thing | Shape |
|---|---|
| Photos | **Square corners**, always |
| Featured photos | 1px gold frame set inside the edge (6px in on phone, 8px on desktop) |
| Buttons | 12px rounded corners, 52–58px tall |
| Icon buttons | Circles, 44px, thin border |
| Search bar, chips, tags | Fully rounded |
| Your messages, file cards | 12px and 10px corners |
| Bottom sheets | 24px top corners, gold top line |
| Welcome page | 1px gold frame inset from the screen edge (14px phone, 20px desktop) |

Icons are thin line drawings (1.2–1.6px) with square corners, as in D's menu.

## 6. Building blocks

| Component | Looks like | Notes |
|---|---|---|
| Wordmark | "Localites" in Playfair 700 | Always links to Home |
| Primary button | Black, light text, capitals | One per screen area |
| Secondary button | Clear, gold outline, capitals | e.g. "Add to event", "Not yet" |
| Text link | Small capitals, underlined | "View", "Change", "Find vendors" |
| Icon button | 44px circle | Back, close, more, account |
| Search bar | Rounded, `surface`, magnifier | Opens search |
| Photo card | Square photo, name in Playfair, details in Jost | Optional gold frame and save heart |
| Featured row | Heading **"Featured near Orillia"** then photo cards | Paid placement; see §9 |
| Result row | Square thumbnail, name, area served, price or tag | |
| Status | **Booked**: gold-outlined tag with a tick. Others (Considering, Awaiting reply, Not on Localites yet): small capitals in `muted` | Never colour alone |
| Section label + rule | Small-capital label over a hairline; gold rule under page titles | |
| Message | Theirs: plain text with a small-capital name and time. Yours: `tint` box | |
| File card | Gold-bordered, file name and size | An invoice is just a file |
| Composer | Attach, text field, round black send button | |
| Bottom sheet | Dimmed page behind, sheet rises from the bottom | Mark as booked |
| Rating | Five black stars, a word label ("Exceptional") | |
| Count block | Large Playfair number over a small-capital label | Going, Maybe, Can't go, No reply |
| Payment notice | One small line | Wording in §9 |

## 7. Navigation

- Tapping **"Localites"** always returns to Home.
- **No menu button.** The top-left corner is kept for **Back**, shown only when there's
  somewhere to go back to.
- **Account** is top right on Home (phone) and at the end of the top menu (desktop).
- **Phone:** four bottom tabs: **Explore, Saved, Events, Messages**.
- **Desktop:** the same four as a menu across the top, beside a wide search bar.

## 8. Phone, tablet and desktop arrangements

Widths: phone below 768px (designed first), tablet 768–1199px, desktop 1200px and up.

| Screen | Phone | Desktop (tablet sits between) |
|---|---|---|
| Welcome | Words in the upper third, buttons two-thirds down, stacked | Words and buttons centred, side by side; no photos |
| Home | Search bar, Featured row (scrolls sideways), Collections | Title and category chips, Featured 4 across, Collections 3 across |
| Search | Results list; filters open from a button | Filters in a left column, results on the right |
| Vendor profile | Photo on top; Add to event / Message bar fixed at the bottom | Large photo left; details, prices and buttons right |
| Conversation | One conversation, full screen | Inbox, conversation and event panel side by side |
| Event plan | One column; guests reached from the plan | Vendors left; guest counts, invite and updates panel right |
| Invitation and guest pages | One column | The same card, centred, at most 480px wide |

Mockups: phone `G-00` to `G-14`; desktop `G-D1` to `G-D6`.

## 9. Content rules

- **Paid placement is shown as paid.** Paid spots appear only under the heading
  "Featured near Orillia" (or "Featured"). Never "Popular", "Top" or "Recommended".
  Search results are never paid for and are fairly ordered.
- **No payments.** Conversations, Mark as booked and the business side carry the line
  *"Localites doesn't process payments. Arrange payment directly with the business."*
  (business side: "…with your customer").
- **Guest privacy is stated where it matters.** Invite screens say guests never see
  vendors, budget, notes or other guests' replies.
- **Words we use:** Event (not "occasion"), Booked, Considering, Awaiting reply, Not on
  Localites yet, Mark as booked, Browse local, Plan an event. **Message** on claimed,
  verified businesses; **Inquire** (secondary button) on businesses not yet on Localites
  (D-04), never both. Welcome reads "Welcome to
  Localites." / "See what your community has to offer…".
- Language rules in [A §6](./A-product-blueprint.md#6-language-rules) apply throughout.

## 10. Accessibility

- Text contrast at least 4.5:1 (3:1 for large text). Gold never carries text.
- Every tap target at least 44 × 44px.
- A visible focus ring on every control (2px `ink`, 2px offset).
- Real buttons, links and labelled inputs; icon-only buttons have a spoken name.
- Status always uses words, never colour alone.
- Respect "reduce motion" settings.
- Business photos carry a description supplied by the business.
