# Build-a-Band

A browser RPG/sim about starting a local band from nothing. You make a musician, buy pawn-shop gear, post for members, sort through auditions, fight the calendar, play basements, record demos, and climb toward theaters.

Everything is generated procedurally from rules and data tables (`src/engine/data.js`). Nothing uses AI at runtime and there is no server. Each new game gets a seed, so every playthrough has a different scene, different people and different venues. Typing in the same seed reproduces the same world.

## Play it

It's a static site with no build step and no dependencies.

```bash
npm run serve        # python3 -m http.server 8080, then open http://localhost:8080
```

**Deploy to GitHub Pages:** go to repo Settings → Pages → "Deploy from a branch", then pick the branch and `/ (root)`. That's all. The save lives in the player's `localStorage`, with export/import as text in the footer.

```bash
npm test             # engine tests (node:test, no installs needed)
npm run balance      # runs a scripted bot through a year in several genres/sizes
npm run bump         # bump the ?v= cache-busting version after changing files (do this before every deploy)
```

## Architecture

```
index.html, styles.css
src/engine/          pure game logic: no DOM, runs in Node and the browser
  rng.js             seeded, serializable RNG (mulberry32)
  data.js            all content: instruments, gear, genres, venues, studios, names, extras, text
  state.js           state shape, ids, inbox threads, news feed
  people.js          members, attributes, "cred", XP, tiers, generation
  band.js            band model, genre lineup rules, performance score
  recruiting.js      recruiting posts, auditions, adding/removing members
  schedule.js        calendar events, attendance, reschedule threads, practices, fire/quit
  gigs.js            show offers, booking rules, gig results, venue standing
  studio.js          recording sessions, quality/reaction, releases and downloads
  social.js          posts, engagement, hype
  economy.js         gear shop, band fund, payouts, pay requests
  scene.js           other local bands (bills), openings to join other bands
  npc.js             AI leaders of bands you join
  sim.js             new game, daily tick, inbox action dispatch
src/ui/              plain ES modules that render HTML strings, plus one delegated event handler
tests/               node:test suite + scripted bot used for balance
```

The whole game state is one JSON object, including the RNG position. Saving means `JSON.stringify`, and loading a save continues on exactly the same future (there's a test for that). The engine and UI are fully separate, so a future server could run the same engine code.

## How the systems connect

- **Cred** is the overall worth rating: attributes ×2, +4 for lead vocals over an instrument (+2 backing), gear tier, owning a PA, extras. It decides who answers your posts and which bands accept you.
- **Attributes** (skill, experience, charisma, reliability) start capped at 10 total for amateurs. XP comes from practices, gigs, recording and practicing alone. A total of 20 makes you semi-pro, 30 makes you pro. When an NPC amateur crosses into semi-pro, they DM you asking for pay. You pay them, counter, or let them go. If you ignore them, they quit.
- **Reliability** moves with behavior. Showing up nudges it up. No-shows without notice knock it down. Members with low reliability and repeated no-shows trigger a "we need to talk about X" thread.
- **Scheduling.** Amateurs have day jobs that make some evenings busy. Two days before an event, each member privately decides whether they can make it. Reliable members ask to reschedule (other members chime in about the proposed day, and you decide). Flaky members just don't come. Paid members almost always show.
- **Practice** builds tightness, writes songs and teaches songs to members who don't know them. Bigger bands learn more slowly (coordination drag). Absent members fall behind on the setlist, and a member who doesn't know the songs drags the show down.
- **Gigs.** The crowd is your fans plus the other bands' fans plus walk-ins. New followers come from people who haven't seen you yet. Basements draw from a finite local DIY pool, so they plateau. Bigger venues need followers and real recordings. Bills with a band that has a following bring in new ears.
- **Recording.** Basement demos are free and unlimited but cap production at 40. Student class projects are free but overnight and variable. Budget and pro studios cost money per session, and rushing them makes a sloppy mix. Audience reaction depends mostly on performance, so a polished mix of a weak performance reads as "lifeless".
- **Releases.** Downloads depend on followers × engagement × hype (from teaser posts) × reaction, plus discovery. Engaged fans download it. Mostly discovery brings new followers.
- **Social.** Engagement decays without posts. Post types behave differently: flyers need an upcoming show, practice clips depend on tightness, memes are swingy, teasers build hype. Three posts a day is spam.
- **Money.** Gigs pay the band fund. The fund pays practice rooms, studios, PA rentals and wages. You pay yourself by splitting the fund with the unpaid members, and you can top a fund up from your own cash anywhere it runs short. Leaders can set any member's rate or give a one-time bonus at any time (raises build loyalty; deep cuts can make people quit).
- **Your day job.** Your profile's evenings are your work shifts: more shifts, more pay (about $25 + $22 per shift per week). Bands you've joined avoid your work nights, and playing on one costs you that shift's pay.
- **Merch.** Order stock up front (stickers, buttons, posters, shirts, totes, hoodies). Bigger runs cost less per unit. Recordings can be released digital-only (free) or pressed as CDs (500 / 1,000 / 5,000) or vinyl (300 / 500 / 1,000). Stock sells at shows (fans buy more than strangers, great sets sell more, broke basement crowds buy cheap stuff) and trickles out online. Every show recap lists what sold, revenue, cost and margin.

## Band size and genre: hard in different ways

| | Small (2-3) | Mid (4) | Large (5+) |
|---|---|---|---|
| Booking | Bars require a demo; need ~25% more followers to move up | baseline | Venues like them: ~20-30% lower follower bar, extra offers |
| On stage | Each member's cred is a big share of the show | | Weak members are diluted |
| Cost | Cheap room, small payroll | | Bigger room, more wages |
| Learning | Fast | | Slow to teach, tightness grows slowly |
| Scheduling | Easy | | Constant reschedule requests and no-shows |

Genres change what matters. Punk forgives skill and has a huge DIY scene. Prog needs chops, writes songs slowly and has a tiny basement scene. Death metal leans on gear. In the scripted-bot balance run, every genre and size reaches roughly the same place after a year (600-1,100 followers, club/hall standing). The reasons each band got stuck differ.

## Judgment calls I made (where the spec was ambiguous)

1. **"2-3 members minimum" for folk/punk/emo/hardcore:** treated as a minimum of 2. The lineup needs a guitarist or bassist plus a drummer. The vocal rule is satisfied by any member who sings, not only the guitarist/bassist/drummer, so a 4-piece punk band with a dedicated frontperson works.
2. **4-member genres** (screamo/thrash/death/metalcore) also require guitar, bass, drums and someone singing. **Prog** needs 5+, those core roles, plus at least one "extra" (keys, a second guitar, violin, sax).
3. **"Vocals only"** is available as a role (mic, optionally a PA), even though the spec framed vocals as an add-on. Screamo and metalcore need frontpeople.
4. **The rating name:** "Cred".
5. **Time:** the game is turn-based by day ("Next day" / "Next week"). "Next week" stops early when a new decision lands in your inbox.
6. **A part-time job** gives the player a small weekly income, so a broke player isn't permanently stuck. Paying yourself from bands is still the real growth path.
7. **Paid tiers are gated by the band fund.** Offering semi-pro pay requires about 8 events' worth of wages in the fund. Pros also need club standing or a leader with 45+ cred.
8. **Joining other bands:** the Scene board lists bands with openings and a cred target. If they accept you, their NPC leader runs the calendar, recordings and socials. You can't edit their schedule, but you can ask to move or skip practices and studio sessions, give notice that you can't make something, and every show is proposed to you first: it's only booked if you say you're in. Double-booking yourself across bands still makes you miss one event (and costs reliability).

## Multiplayer: recommendation

**I recommend shipping single-player first (this build), then adding light async social features, and only then considering shared bands.**

- **Difficulty:** Shared bands are the hard part. The sim is time-driven, so co-owned bands need one authoritative clock. That means the daily tick runs on a server (e.g. a Supabase Edge Function on a cron) instead of when you click "Next day". It also means conflict handling when two players act at once, plus real-time chat. That roughly doubles the project and turns a pleasant offline game into a live service.
- **Cost:** Supabase's free tier would cover a hobby audience. Cost isn't the blocker.
- **Safety:** This is the real concern. User accounts, free-text chat and player-named bands bring moderation, reporting, blocking, minors and harassment. You said you'd rather not worry about security, and an open multiplayer chat is the part of this where not worrying goes wrong.
- **A middle path that's cheap and safe:** a Supabase table where players optionally publish a snapshot of their band (name from a filter list or the generator, genre, followers). Other players' games pull those snapshots in as "scene bands" on show bills and the Scene board, plus a global leaderboard. That needs no chat, no shared clock, and keeps the engine unchanged. The engine already treats scene bands as plain data, so this is a small add-on.

## Monetization

The footer has a "Buy me a coffee" link to https://buymeacoffee.com/branelectro (set in `index.html`).
