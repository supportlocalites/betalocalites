# Design archive

Every design explored for Localites, kept so we can look back. **The chosen direction
is G** (decision D-21, 10 October 2026). How G is built is set out in
[design-system.md](../design-system.md).

**The live canvas** (where these screens can be viewed, clicked through and compared):
<https://claude.ai/artifact/UDGyZeaxGKyoBimqLAUjJe>. It's private to the product owner
until shared. The files in this folder are a saved copy of it, taken on 10 October 2026.

**Sample content only.** Every business, person, price, message and review in these
screens is made up.

---

## The directions

| Row | Name | What it was | Files | Status |
|---|---|---|---|---|
| A | Browse | Familiar discovery app: search on top, photo cards, teal accent. First round. | `Main`, `A-*` | Explored |
| B, C | Local, Plan | First round. Removed: too playful. | — (not kept) | Rejected |
| D | Minimal luxury | Ivory, fine serif, hairlines, square black buttons, generous space. | `D-*` | Explored; its planning screens went into G |
| E | Between A and D | Warm and refined, one deep-teal accent. Stopped after five screens. | `E-*` | Explored |
| F | D's colours, A's layout | Ivory and black, Playfair + Jost, touches of gold. | `F-ivory-*` | Explored; its look became G |
| **G** | **F's look with D's planning screens** | F's style throughout; D's layouts for conversations, the event plan, booking and reviews; guest invites and RSVPs. | `G-00` to `G-14` | **Chosen** |
| G desktop | G on a computer screen | Six key pages laid out for wide screens. | `G-D1` to `G-D6` | **Chosen** (desktop layouts) |
| H | Soft pastel | Inspired by reference screenshots: blush, white cards, sage/honey/rose colour cues. | `H-*` | Explored |

## G screens

| File | Screen | Who sees it |
|---|---|---|
| `G-00-welcome` | Welcome: "Welcome to Localites. See what your community has to offer…" | Everyone |
| `G-01-home` | Home: search, Featured near Orillia, Collections | Consumer |
| `G-02-search` | Search results | Consumer |
| `G-03-profile` | Vendor profile with Add to event / Message | Consumer |
| `G-04-start-conversation` | Start a conversation | Consumer |
| `G-05-conversation` | Conversation | Consumer |
| `G-06-event-plan` | Event plan | Consumer (host) |
| `G-07-mark-booked` | Mark as booked | Consumer (host) |
| `G-08-how-was-it` | How was it? (review) | Consumer (host) |
| `G-09-vendor-conversation` | Conversation, business side | Vendor |
| `G-10-invite-guests` | Invite guests | Host |
| `G-11-invitation` | Invitation and RSVP | Guest (no account) |
| `G-12-guest-list` | Guest list and RSVP totals | Host |
| `G-13-guest-updates` | Updates to guests | Host |
| `G-14-guest-event` | Event page after replying | Guest |
| `G-D1` to `G-D6` | Desktop: Welcome, Home, Search, Profile, Messages, Event plan | Everyone |

## What's in this folder

- `mockups/*.dc.html`: one file per screen, as saved from the canvas. They're drawn with
  the canvas's own runtime, so they show properly **on the canvas**, not when opened on
  their own.
- `mockups/canvas.json`: where each screen sits on the canvas, with the notes beside each
  row.
- `illustrations/*.svg`: the sample artwork used in the photo spots. The mockups refer to
  them by their upload ID on the canvas:

| Illustration | Used for | Canvas upload ID |
|---|---|---|
| `face.svg` | Brightside Face Painting | `d44d01f0c564eb449ab6c546ba0a7ad6` |
| `magic.svg` | The Great Marvello | `80c8c43ba84fa25b6512df2f6ea02d23` |
| `gecko.svg` | Glitter Gecko Face Art | `8451c81d9cbd2a0c5a13fa4126dc49a6` |
| `art.svg` | Tiny Canvas Kids Art | `d24ad3a63f8e38e831ec5298043659f7` |
| `balloons.svg` | Rainbow Room Parties; "For the Littlest Guests" | `abdafaadf1677b80293ca850b3e433bd` |
| `cake.svg` | Mabel's Cake Studio | `edde753d919aef127c5b850e074ab451` |
| `venue.svg` | Lakeview Party Room; "The Indoor Edit" | `ee7e958c65117b21f08decb220bff157` |
| `celebrate.svg` | D's home picture | `cb3edcd3186185f274be52976da68dd3` |

These are placeholders. In the real product, businesses upload their own photos.
