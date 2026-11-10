// Static content tables. Everything the game "writes" is assembled from these
// at runtime by rules: no generative AI, no network.

export const ATTRS = ['skill', 'experience', 'charisma', 'reliability'];
export const ATTR_LABELS = {
  skill: 'Skill',
  experience: 'Experience',
  charisma: 'Charisma',
  reliability: 'Reliability',
};

export const AMATEUR_POINT_CAP = 10;

// ---------------------------------------------------------------------------
// Instruments / roles
// ---------------------------------------------------------------------------
// `gearSlots` lists what a member in this role must own to play a show.
export const INSTRUMENTS = {
  guitar: { label: 'Guitar', noun: 'guitarist', gearSlots: ['guitar', 'guitarAmp'] },
  bass: { label: 'Bass', noun: 'bassist', gearSlots: ['bass', 'bassAmp'] },
  drums: { label: 'Drums', noun: 'drummer', gearSlots: ['drums'] },
  keys: { label: 'Keys', noun: 'keyboardist', gearSlots: ['keys'] },
  violin: { label: 'Violin', noun: 'violinist', gearSlots: ['violin'] },
  sax: { label: 'Saxophone', noun: 'saxophonist', gearSlots: ['sax'] },
  vocals: { label: 'Vocals only', noun: 'vocalist', gearSlots: ['mic'] },
};
export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

export const VOCAL_LABELS = { none: 'No vocals', backing: 'Backing vocals', lead: 'Lead vocals' };

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------
export const GEAR_TIERS = {
  1: 'Pawn Shop Special',
  2: 'Marketplace Score',
  3: 'Pro Rig',
};

const g = (slot, tier, name, price) => ({ id: `${slot}-${tier}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, slot, tier, name, price });

export const GEAR_SLOTS = {
  guitar: 'Guitar',
  guitarAmp: 'Guitar amp',
  bass: 'Bass',
  bassAmp: 'Bass amp',
  drums: 'Drum kit',
  keys: 'Keyboard',
  violin: 'Violin',
  sax: 'Saxophone',
  mic: 'Microphone',
  pa: 'PA system',
};

export const GEAR_CATALOG = [
  g('guitar', 1, 'Dented Strat-alike', 110),
  g('guitar', 1, 'No-name Les Paul copy', 135),
  g('guitar', 2, 'Used Mexican Tele', 380),
  g('guitar', 2, 'Gently-used SG', 420),
  g('guitar', 3, 'Custom Shop Jazzmaster', 1900),
  g('guitarAmp', 1, '15W practice amp', 70),
  g('guitarAmp', 2, 'Used tube combo', 340),
  g('guitarAmp', 3, 'Boutique head + 4x12', 1600),
  g('bass', 1, 'Pawn-shop P-bass copy', 120),
  g('bass', 2, 'Used Jazz Bass', 400),
  g('bass', 3, 'Active 5-string', 1700),
  g('bassAmp', 1, 'Tiny bass combo', 80),
  g('bassAmp', 2, 'Used 300W combo', 320),
  g('bassAmp', 3, 'Stack with 8x10', 1500),
  g('drums', 1, 'Mismatched kit + cracked ride', 180),
  g('drums', 2, 'Used 5-piece maple kit', 550),
  g('drums', 3, 'Pro kit + hardware case', 2400),
  g('keys', 1, 'Thrift-store 61-key', 90),
  g('keys', 2, 'Used stage piano', 520),
  g('keys', 3, 'Workstation synth', 2200),
  g('violin', 1, 'Attic violin', 100),
  g('violin', 2, 'Student violin + pickup', 450),
  g('violin', 3, 'Luthier violin', 2600),
  g('sax', 1, 'Dinged alto sax', 160),
  g('sax', 2, 'Used tenor sax', 600),
  g('sax', 3, 'Pro tenor sax', 2800),
  g('mic', 1, 'Mystery dynamic mic', 25),
  g('mic', 2, 'The classic dynamic mic', 100),
  g('mic', 3, 'Wireless pro vocal mic', 450),
  g('pa', 1, 'Garage-sale PA', 160),
  g('pa', 2, 'Powered speaker pair + mixer', 600),
  g('pa', 3, 'Full PA with subs', 2500),
];
export const GEAR_BY_ID = Object.fromEntries(GEAR_CATALOG.map((x) => [x.id, x]));

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------
// The weights make genres hard in different ways: punk forgives skill but
// needs charisma; prog needs skill and is slow to learn; metal leans on gear.
export const GENRES = {
  folk: {
    label: 'Folk', min: 2, rule: 'core', weights: { skill: 0.9, charisma: 1.3, gear: 0.4, tight: 1.0 },
    learnRate: 1.1, diyScene: 0.9, blurb: 'Warm crowds, lyrics matter, gear barely does.',
  },
  punk: {
    label: 'Punk', min: 2, rule: 'core', weights: { skill: 0.6, charisma: 1.5, gear: 0.5, tight: 0.9 },
    learnRate: 1.3, diyScene: 1.4, blurb: 'Huge DIY scene. Energy beats chops.',
  },
  emo: {
    label: 'Emo', min: 2, rule: 'core', weights: { skill: 0.9, charisma: 1.2, gear: 0.6, tight: 1.0 },
    learnRate: 1.1, diyScene: 1.2, blurb: 'Basement royalty. Socials matter a lot.',
  },
  hardcore: {
    label: 'Hardcore', min: 2, rule: 'core', weights: { skill: 0.7, charisma: 1.4, gear: 0.7, tight: 1.1 },
    learnRate: 1.2, diyScene: 1.3, blurb: 'Tight-knit scene. Show up or get forgotten.',
  },
  screamo: {
    label: 'Screamo', min: 4, rule: 'four', weights: { skill: 1.0, charisma: 1.2, gear: 0.8, tight: 1.1 },
    learnRate: 1.0, diyScene: 1.1, blurb: 'Chaotic, needs a full lineup to land.',
  },
  thrash: {
    label: 'Thrash', min: 4, rule: 'four', weights: { skill: 1.3, charisma: 0.9, gear: 1.1, tight: 1.3 },
    learnRate: 0.9, diyScene: 0.9, blurb: 'Speed and precision. Sloppy gets punished.',
  },
  death: {
    label: 'Death Metal', min: 4, rule: 'four', weights: { skill: 1.4, charisma: 0.7, gear: 1.3, tight: 1.2 },
    learnRate: 0.85, diyScene: 0.8, blurb: 'Loyal fans, demanding chops, heavy gear needs.',
  },
  metalcore: {
    label: 'Metalcore', min: 4, rule: 'four', weights: { skill: 1.1, charisma: 1.1, gear: 1.1, tight: 1.1 },
    learnRate: 0.95, diyScene: 1.0, blurb: 'Big crowds once you climb. Production matters.',
  },
  prog: {
    label: 'Prog Metal', min: 5, rule: 'prog', weights: { skill: 1.6, charisma: 0.7, gear: 1.0, tight: 1.4 },
    learnRate: 0.7, diyScene: 0.6, blurb: 'Small DIY scene, devoted bigger venues. Songs take forever.',
  },
};
export const GENRE_IDS = Object.keys(GENRES);

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------
export const VENUE_TIERS = [
  { tier: 0, label: 'Basement / DIY', capacity: [25, 60], pay: [0, 40], songs: 4, minFollowers: 0, minRecording: 0, poolBase: 140, paRequired: true },
  { tier: 1, label: 'Dive Bar', capacity: [50, 120], pay: [40, 150], songs: 6, minFollowers: 25, minRecording: 30, poolBase: 900, paRequired: false },
  { tier: 2, label: 'Club', capacity: [150, 350], pay: [150, 500], songs: 8, minFollowers: 180, minRecording: 50, poolBase: 4000, paRequired: false },
  { tier: 3, label: 'Mid-size Hall', capacity: [400, 900], pay: [500, 1500], songs: 10, minFollowers: 700, minRecording: 65, poolBase: 15000, paRequired: false },
  { tier: 4, label: 'Theater', capacity: [1000, 2500], pay: [1500, 5000], songs: 12, minFollowers: 2500, minRecording: 78, poolBase: 60000, paRequired: false },
];

export const VENUE_NAMES = {
  0: {
    a: ['The Moldy', 'Uncle Rick\'s', 'The Leaky', 'Big Sad', 'The Spider', 'Grandma\'s', 'The Sunken', 'Haunted', 'Possum', 'The Laundry', 'Flood Zone', 'Cat Hair'],
    b: ['Basement', 'Garage', 'House', 'Cellar', 'Living Room', 'Den', 'Warehouse Loft', 'Shed'],
  },
  1: {
    a: ['The Rusty', 'The Broken', 'Lucky', 'The Neon', 'Tilted', 'The Last', 'Copper', 'The Grimy', 'Velvet', 'The Gutter'],
    b: ['Nail', 'Spoke', 'Anchor', 'Lantern', 'Stool', 'Tap', 'Moth', 'Coyote', 'Hatchet', 'Rail'],
  },
  2: {
    a: ['The Echo', 'Union', 'The Vault', 'Blackbird', 'Riverside', 'Static', 'The Foundry', 'Electric'],
    b: ['Room', 'Hall', 'Lounge', 'Club', 'Social', 'Ballroom', 'Works'],
  },
  3: {
    a: ['The Grand', 'Majestic', 'Harbor', 'Paramount', 'Crystal', 'Old Mill'],
    b: ['Hall', 'Music Hall', 'Pavilion', 'Auditorium', 'Exchange'],
  },
  4: {
    a: ['The Orpheum', 'Rialto', 'The Palace', 'Fillmore-ish', 'Starlight', 'The Regent'],
    b: ['Theater', 'Theatre', 'Opera House'],
  },
};

// ---------------------------------------------------------------------------
// Studios
// ---------------------------------------------------------------------------
export const STUDIO_TYPES = {
  basement: {
    label: 'Basement demo',
    blurb: 'Free, record in your own space. Take as long as you like, but it will always sound like a basement.',
    costPerSession: 0, productionRange: [15, 38], productionCap: 40, minSessions: 1, oddHours: false,
  },
  student: {
    label: 'Recording-school class project',
    blurb: 'A student engineer records you free for their grade. Overnight slots only, and quality depends on the student.',
    costPerSession: 0, productionRange: [40, 72], productionCap: 75, minSessions: 3, oddHours: true,
  },
  cheap: {
    label: 'Budget studio',
    blurb: 'Real room, clock always running. Rush it and the mix suffers.',
    costPerSession: 180, productionRange: [52, 76], productionCap: 82, minSessions: 1, oddHours: false,
  },
  pro: {
    label: 'Pro studio',
    blurb: 'Great engineer, great room, great invoice.',
    costPerSession: 650, productionRange: [72, 95], productionCap: 98, minSessions: 1, oddHours: false,
  },
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export const FIRST_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Jamie', 'Taylor', 'Quinn', 'Avery',
  'Dakota', 'Skyler', 'Rowan', 'Reese', 'Hayden', 'Parker', 'Emerson', 'Kai', 'Sage', 'Drew',
  'Marisol', 'Dev', 'Priya', 'Tomas', 'Ines', 'Kenji', 'Aiyana', 'Wren', 'Theo', 'Nadia',
  'Bex', 'Ozzie', 'Lou', 'Fern', 'Gus', 'Iris', 'Milo', 'June', 'Rafa', 'Zoe',
  'Malik', 'Lena', 'Cyrus', 'Hollis', 'Juno', 'Ash', 'Benny', 'Coco', 'Dario', 'Elif',
];
export const LAST_NAMES = [
  'Park', 'Reyes', 'Novak', 'Okafor', 'Lindqvist', 'Haddad', 'Moreau', 'Kowalski', 'Tanaka', 'Silva',
  'Brennan', 'Achebe', 'Ferreira', 'Holt', 'Ivanova', 'Jensen', 'Khan', 'Lopez', 'Mbeki', 'Nguyen',
  'O\'Shea', 'Petrov', 'Quintero', 'Rossi', 'Schmidt', 'Toro', 'Underwood', 'Vance', 'Whitlock', 'Yilmaz',
];
export const NICKNAMES = ['Spud', 'Moose', 'Static', 'Toast', 'Ghost', 'Beans', 'Ripley', 'Gravel', 'Hex', 'Pidge', 'Sprout', 'Bolt'];

// Day jobs define amateur availability. Days: 0=Mon ... 6=Sun. `busy` lists
// evenings they are usually unavailable.
export const DAY_JOBS = [
  { job: 'barista (closing shifts)', busy: [4, 5] },
  { job: 'line cook', busy: [4, 5, 6] },
  { job: 'night-shift warehouse worker', busy: [0, 1, 2] },
  { job: 'college student', busy: [1, 3] },
  { job: 'retail associate', busy: [5, 6] },
  { job: 'bartender', busy: [3, 4, 5] },
  { job: 'delivery driver', busy: [4, 6] },
  { job: 'nurse (rotating shifts)', busy: [0, 3, 5] },
  { job: 'high-school teacher', busy: [6] },
  { job: 'dog walker', busy: [] },
  { job: 'freelance designer', busy: [2] },
  { job: 'parent of a toddler', busy: [0, 2, 4] },
  { job: 'call-center rep', busy: [1, 2] },
  { job: 'grad student', busy: [0, 3] },
];

export const EXCUSES = [
  'my manager just put me on a double', 'my car is making The Noise again', 'I have a family thing I forgot about',
  'I think I\'m coming down with something', 'my landlord is doing an inspection', 'I have an exam the next morning',
  'my sister needs help moving', 'I picked up an extra shift, I need the money', 'my dog ate something weird',
  'there\'s a work training I can\'t skip', 'my roommate locked me out', 'it\'s my partner\'s birthday',
];

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------------------------------------------------------------------------
// Extras: the things that can make a weak candidate worth picking.
// `effect` keys are read by the systems that care about them.
// ---------------------------------------------------------------------------
export const EXTRAS = [
  { id: 'pa', label: 'Owns a PA', detail: 'Brings a PA system: basement shows need one.', weight: 3, grantsGear: 'pa' },
  { id: 'van', label: 'Has a van', detail: 'Hauls the gear. Fewer gig no-shows; out-of-town gigs pay a bit more.', weight: 3, effect: { gigReliability: 0.15, gigPay: 0.1 } },
  { id: 'space', label: 'Has a rehearsal space', detail: 'Free practice space (saves the room rental every practice).', weight: 3, effect: { freePractice: true } },
  { id: 'venueRelative', label: 'Relative owns a venue', detail: 'Their relative books a bar. Guaranteed show offers there.', weight: 2, effect: { venueConnection: 1 } },
  { id: 'studioRelative', label: 'Relative runs a studio', detail: 'Studio sessions at a steep family discount.', weight: 2, effect: { studioDiscount: 0.6 } },
  { id: 'engineerFriend', label: 'Roommate studies audio engineering', detail: 'Class-project recordings at normal hours, and the roommate is good.', weight: 2, effect: { studentBoost: 12 } },
  { id: 'promoter', label: 'Knows a promoter', detail: 'More show offers each week.', weight: 2, effect: { extraOffers: 1 } },
  { id: 'influencer', label: 'Has a personal following', detail: 'Brings followers with them and boosts posts.', weight: 2, effect: { followers: 120, postBoost: 0.25 } },
  { id: 'designer', label: 'Graphic designer', detail: 'Flyers and merch art: posts and release hype hit harder.', weight: 2, effect: { postBoost: 0.2, hypeBoost: 0.25 } },
  { id: 'mentor', label: 'Sibling in a touring band', detail: 'Pulls the whole band\'s experience up faster.', weight: 1, effect: { bandXp: 0.2 } },
  { id: 'songwriter', label: 'Prolific songwriter', detail: 'New songs come together faster.', weight: 2, effect: { songRate: 0.35 } },
  { id: 'cash', label: 'Has savings to chip in', detail: 'Puts some cash into the band fund when they join.', weight: 2, effect: { bandCash: 250 } },
];
export const EXTRAS_BY_ID = Object.fromEntries(EXTRAS.map((e) => [e.id, e]));

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------
export const BAND_NAME_PARTS = {
  a: ['Velvet', 'Paper', 'Broken', 'Neon', 'Sad', 'Feral', 'Cosmic', 'Rust', 'Holy', 'Glass', 'Static', 'Hollow', 'Wild', 'Iron', 'Sleepy', 'Electric', 'Midnight', 'Dead', 'Golden', 'Concrete', 'Teenage', 'Lunar', 'Plastic', 'Burnt'],
  b: ['Wolves', 'Lungs', 'Saints', 'Orchards', 'Satellites', 'Moths', 'Teeth', 'Lanterns', 'Ghosts', 'Rivers', 'Machines', 'Daughters', 'Pilots', 'Weather', 'Vultures', 'Hands', 'Cathedral', 'Signal', 'Coyotes', 'Fever', 'Archive', 'Tides', 'Heron', 'Antlers'],
  single: ['Thistle', 'Grief Bacon', 'Mothercoat', 'Pale Hum', 'Sunbleach', 'Car Seat Ghosts', 'Wet Paint', 'Gutterlight', 'Ostrich', 'Hex Key', 'Dog Years', 'Tin Roof', 'Necrovore', 'Abyssal Throne', 'Septic Oracle', 'Fractal Monolith', 'Ninth Spiral'],
};

export const SONG_WORDS = {
  a: ['Basement', 'Summer', 'Static', 'Motel', 'Paper', 'Velvet', 'Last', 'Burning', 'Neon', 'Quiet', 'Sunday', 'Broken', 'Endless', 'Rotten', 'Silver'],
  b: ['Hearts', 'Teeth', 'Highway', 'Ghosts', 'Lungs', 'Bridges', 'Weather', 'Prayer', 'Mirrors', 'Fever', 'Satellite', 'Kids', 'Ashes', 'Signals', 'Doorways'],
};

// ---------------------------------------------------------------------------
// Social media
// ---------------------------------------------------------------------------
export const POST_TYPES = {
  flyer: { label: 'Show flyer', blurb: 'Big boost if a show is coming up.', engagement: 6, followers: 0.012, hype: 0 },
  bts: { label: 'Practice clip', blurb: 'Steady engagement. Better when the band is tight.', engagement: 5, followers: 0.01, hype: 0 },
  meme: { label: 'Band meme', blurb: 'Swingy. Can go viral or flop.', engagement: 4, followers: 0.015, hype: 0, swing: true },
  teaser: { label: 'Release teaser', blurb: 'Builds hype for an unreleased recording.', engagement: 3, followers: 0.006, hype: 0.18 },
};

export const CROWD_REACTIONS = {
  great: ['The floor was shaking by the second song.', 'People were singing along to songs they\'d never heard.', 'Someone crowd-surfed into a ceiling fan (they\'re fine).', 'The promoter asked when you can come back.'],
  good: ['Solid set. A few new faces asked for your socials.', 'A respectable pit opened up during the closer.', 'The crowd warmed up halfway through.'],
  meh: ['Polite applause. Some people were on their phones.', 'The sound was muddy and the crowd drifted to the bar.', 'Half the room left before your last song.'],
  bad: ['The set fell apart in the middle and never came back.', 'Someone yelled "PLAY FREEBIRD" and it was the highlight.', 'You heard the sound person sigh into the talkback mic.'],
};
