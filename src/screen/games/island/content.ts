// Everything the island is stocked with: what you can buy, wear, hang on a
// wall, and hear in the concert hall, plus the phrasings the island uses to
// narrate itself.
//
// All of it is written for this project. Tomodachi Life's own item names,
// dialogue and song lyrics are its authors' work, so none of them appear
// here -- what is recreated is the shape of the systems, not their text.

export interface Food {
  id: string;
  name: string;
  icon: string;
  price: number;
  /** Nudges which personalities tend to like it, so tastes feel coherent
   * rather than purely random. */
  flavour: "sweet" | "savoury" | "fresh" | "hearty" | "odd";
}

export const FOODS: Food[] = [
  { id: "riceball", name: "Rice Ball", icon: "🍙", price: 8, flavour: "savoury" },
  { id: "ramen", name: "Big Bowl of Ramen", icon: "🍜", price: 22, flavour: "hearty" },
  { id: "toast", name: "Butter Toast", icon: "🍞", price: 6, flavour: "hearty" },
  { id: "pancakes", name: "Stack of Pancakes", icon: "🥞", price: 18, flavour: "sweet" },
  { id: "curry", name: "House Curry", icon: "🍛", price: 24, flavour: "hearty" },
  { id: "sushi", name: "Corner-Shop Sushi", icon: "🍣", price: 30, flavour: "fresh" },
  { id: "salad", name: "Garden Salad", icon: "🥗", price: 12, flavour: "fresh" },
  { id: "apple", name: "Crisp Apple", icon: "🍎", price: 4, flavour: "fresh" },
  { id: "banana", name: "Slightly Bruised Banana", icon: "🍌", price: 3, flavour: "fresh" },
  { id: "burger", name: "Double Burger", icon: "🍔", price: 26, flavour: "hearty" },
  { id: "pizza", name: "Whole Pizza", icon: "🍕", price: 28, flavour: "savoury" },
  { id: "taco", name: "Street Taco", icon: "🌮", price: 14, flavour: "savoury" },
  { id: "dumplings", name: "Steamed Dumplings", icon: "🥟", price: 20, flavour: "savoury" },
  { id: "omelette", name: "Fluffy Omelette", icon: "🍳", price: 16, flavour: "hearty" },
  { id: "cake", name: "Slice of Cake", icon: "🍰", price: 25, flavour: "sweet" },
  { id: "donut", name: "Sprinkle Donut", icon: "🍩", price: 9, flavour: "sweet" },
  { id: "icecream", name: "Two-Scoop Cone", icon: "🍦", price: 11, flavour: "sweet" },
  { id: "pudding", name: "Wobbly Pudding", icon: "🍮", price: 13, flavour: "sweet" },
  { id: "cookie", name: "Enormous Cookie", icon: "🍪", price: 7, flavour: "sweet" },
  { id: "soup", name: "Soup of the Day", icon: "🥣", price: 15, flavour: "hearty" },
  { id: "cheese", name: "Very Strong Cheese", icon: "🧀", price: 19, flavour: "odd" },
  { id: "pepper", name: "Whole Chilli Pepper", icon: "🌶️", price: 5, flavour: "odd" },
  { id: "pickle", name: "Jar of Pickles", icon: "🥒", price: 10, flavour: "odd" },
  { id: "seaweed", name: "Seaweed Snack", icon: "🌿", price: 6, flavour: "odd" },
  { id: "steak", name: "Birthday Steak", icon: "🥩", price: 40, flavour: "hearty" },
  { id: "sundae", name: "Towering Sundae", icon: "🍨", price: 35, flavour: "sweet" },
];

export const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]));

/** The six reactions a Mii can have to a mouthful, best first. */
export const REACTIONS = [
  "Super All-Time Favourite",
  "All-Time Favourite",
  "Likes It",
  "So-So",
  "Doesn't Like It",
  "Worst Food Ever",
] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Happiness a reaction is worth, before the price bonus. */
export const REACTION_HAPPINESS: Record<Reaction, number> = {
  "Super All-Time Favourite": 55,
  "All-Time Favourite": 32,
  "Likes It": 15,
  "So-So": 6,
  "Doesn't Like It": -8,
  "Worst Food Ever": -18,
};

/** What the Mii says. One line per reaction, kept short enough for a speech
 * bubble on a TV. */
export const REACTION_LINES: Record<Reaction, string[]> = {
  "Super All-Time Favourite": ["This is the one!!", "I have waited my whole life for this.", "Do not speak to me. I am busy."],
  "All-Time Favourite": ["Oh, this is SO good.", "You remembered!", "Best thing I've eaten all week."],
  "Likes It": ["Mm, nice.", "Yeah, I'd have that again.", "That hit the spot."],
  "So-So": ["It's… food.", "Fine, I guess.", "Well. That happened."],
  "Doesn't Like It": ["Ugh. Really?", "I ate it. I'm not happy about it.", "That was a choice."],
  "Worst Food Ever": ["WHY.", "I will remember this.", "Absolutely not. Never again."],
};

export interface Outfit {
  id: string;
  name: string;
  price: number;
  /** Recoloured onto the Mii's shirt while worn. */
  color: string;
  style: "plain" | "striped" | "collared" | "hoodie";
}

export const OUTFITS: Outfit[] = [
  { id: "sunday", name: "Sunday Best", price: 60, color: "#2f4f8f", style: "collared" },
  { id: "stripes", name: "Holiday Stripes", price: 45, color: "#e05a5a", style: "striped" },
  { id: "cosy", name: "Cosy Hoodie", price: 40, color: "#5a7a3b", style: "hoodie" },
  { id: "sunshine", name: "Sunshine Tee", price: 30, color: "#f4a300", style: "plain" },
  { id: "midnight", name: "Midnight Jumper", price: 55, color: "#2b2b45", style: "plain" },
  { id: "seafoam", name: "Seafoam Shirt", price: 38, color: "#3bc4a1", style: "collared" },
  { id: "berry", name: "Berry Cardigan", price: 50, color: "#8a3bc4", style: "hoodie" },
  { id: "coral", name: "Coral Stripes", price: 42, color: "#e85d9e", style: "striped" },
  { id: "slate", name: "Slate Workwear", price: 35, color: "#5a5a5a", style: "collared" },
  { id: "lemon", name: "Lemon Polo", price: 33, color: "#c4a13b", style: "collared" },
  { id: "cobalt", name: "Cobalt Hoodie", price: 48, color: "#3b3bc4", style: "hoodie" },
  { id: "moss", name: "Moss Tee", price: 28, color: "#3bb54a", style: "plain" },
];

export const OUTFIT_BY_ID = new Map(OUTFITS.map((o) => [o.id, o]));

export interface Interior {
  id: string;
  name: string;
  price: number;
  /** Wall and floor of the little room drawn in the apartment block. */
  wall: string;
  floor: string;
  prop: string;
}

export const INTERIORS: Interior[] = [
  { id: "starter", name: "Starter Room", price: 0, wall: "#f0e3cd", floor: "#c9a46f", prop: "📦" },
  { id: "seaside", name: "Seaside Room", price: 70, wall: "#cfe9f2", floor: "#e6d3a3", prop: "🐚" },
  { id: "forest", name: "Forest Room", price: 70, wall: "#d7e8cf", floor: "#8f6b45", prop: "🪴" },
  { id: "studio", name: "Painter's Studio", price: 90, wall: "#f3efe6", floor: "#b9995f", prop: "🎨" },
  { id: "arcade", name: "Arcade Room", price: 90, wall: "#2b2b45", floor: "#4a4a6a", prop: "🕹️" },
  { id: "library", name: "Reading Room", price: 85, wall: "#e8ddc6", floor: "#7a5a35", prop: "📚" },
  { id: "space", name: "Observatory", price: 110, wall: "#1b2340", floor: "#3a4570", prop: "🔭" },
  { id: "bakery", name: "Bakery Flat", price: 80, wall: "#f7e2d0", floor: "#d0a476", prop: "🧁" },
  { id: "dojo", name: "Quiet Dojo", price: 95, wall: "#efe6d2", floor: "#a5813f", prop: "🎋" },
  { id: "neon", name: "Neon Loft", price: 120, wall: "#22143a", floor: "#4b2f6b", prop: "💡" },
];

export const INTERIOR_BY_ID = new Map(INTERIORS.map((i) => [i.id, i]));

/** Level-up rewards that live in the room and give the Mii something to do
 * on their own. */
export const GIFTS = [
  { id: "guitar", name: "Second-Hand Guitar", icon: "🎸" },
  { id: "camera", name: "Little Camera", icon: "📷" },
  { id: "console", name: "Handheld Console", icon: "🎮" },
  { id: "kettle", name: "Whistling Kettle", icon: "🫖" },
  { id: "plant", name: "Demanding Houseplant", icon: "🪴" },
  { id: "skates", name: "Roller Skates", icon: "🛼" },
  { id: "telescope", name: "Wobbly Telescope", icon: "🔭" },
  { id: "radio", name: "Old Radio", icon: "📻" },
  { id: "ball", name: "Well-Loved Football", icon: "⚽" },
  { id: "cat", name: "Cat Who Visits", icon: "🐈" },
];

export const GIFT_BY_ID = new Map(GIFTS.map((g) => [g.id, g]));

/** Songs a Mii can learn and then perform in the Concert Hall. Words and
 * titles written for this island. */
export interface Song {
  id: string;
  title: string;
  genre: string;
  lines: string[];
}

export const SONGS: Song[] = [
  {
    id: "ferry",
    title: "Last Ferry Home",
    genre: "Ballad",
    lines: ["The lights go out along the pier,", "but I know the way from here,", "and the water knows my name."],
  },
  {
    id: "elevator",
    title: "Six Floors Up",
    genre: "Pop",
    lines: ["Six floors up and one door left,", "I have practised what to say,", "and I'll say it all wrong anyway!"],
  },
  {
    id: "noodles",
    title: "Noodles At Midnight",
    genre: "Rap",
    lines: ["Steam on the window, spoon in my hand,", "nobody told me adulthood was this bland,", "so I season it myself — understand?"],
  },
  {
    id: "sunhat",
    title: "Big Hat, Small Island",
    genre: "Summer",
    lines: ["Big hat, small island, nothing to do,", "the tide comes in, and so do you,", "and that is the whole of the news."],
  },
  {
    id: "storm",
    title: "Weather Warning",
    genre: "Rock",
    lines: ["They said stay in, they said batten down,", "I have never once done what I was told,", "and the rain has never once caught me cold!"],
  },
  {
    id: "lullaby",
    title: "Quiet Hours",
    genre: "Lullaby",
    lines: ["Hush now, the corridor's asleep,", "the lift has stopped, the kettle's cool,", "and morning keeps for one more hour."],
  },
  {
    id: "market",
    title: "Two For One",
    genre: "Musical",
    lines: ["Everything's two for one today!", "I bought a thing I did not need,", "and I regret it in the best way!"],
  },
  {
    id: "opera",
    title: "The Neighbour Complains",
    genre: "Opera",
    lines: ["I have HEARD you, at THREE in the MORNING,", "through a wall that is barely a wall,", "and I forgive you — I forgive you all!"],
  },
];

export const SONG_BY_ID = new Map(SONGS.map((s) => [s.id, s]));

/** Catchphrase options offered at a level-up. Deliberately daft. */
export const CATCHPHRASES = [
  "…probably.",
  "Big if true.",
  "Anyway, that's me.",
  "Not to be dramatic, but",
  "Respectfully? No.",
  "I've thought about this a lot.",
  "As is tradition.",
  "Frankly, wonderful.",
  "Do NOT ask me how.",
  "It's a whole thing.",
];

/** What two Miis got up to when they spent time together. `%a` and `%b` are
 * replaced with their names. */
export const FRIENDLY_SCENES = [
  "%a knocked on %b's door for no reason at all.",
  "%a and %b split a snack in the corridor.",
  "%a told %b a story that went on far too long. %b loved it.",
  "%a and %b sat on the sea wall and said nothing for an hour.",
  "%b helped %a carry something heavy up the stairs.",
  "%a and %b argued about the best flavour of everything.",
  "%a taught %b a card trick. It did not work.",
  "%a and %b queued for the same thing and became friends by attrition.",
];

export const ROMANTIC_SCENES = [
  "%a keeps finding reasons to walk past %b's door.",
  "%b laughed at %a's joke a bit too hard.",
  "%a rehearsed something in the mirror. It was about %b.",
  "%a and %b took the long way home.",
];

export const QUARREL_SCENES = [
  "%a and %b fell out over whose turn it was to buy milk.",
  "%a said something %b is not going to forget.",
  "%a and %b are no longer speaking, and neither will say why.",
];

export const SOLO_SCENES = [
  "%a is rearranging the furniture again.",
  "%a is staring into the fridge with real hope.",
  "%a has been practising a song all afternoon.",
  "%a is pretending to read.",
  "%a fell asleep with the light on.",
  "%a is doing something in the corridor. Nobody has asked what.",
];

/** Headlines for the Mii News ticker; `%a` is a resident name. */
export const NEWS_FILLER = [
  "The lift is working again. Nobody trusts it.",
  "%a has opinions about the new bench in the park.",
  "Weather: fine, briefly.",
  "The Food Mart is out of everything good.",
  "A seagull has been named honorary resident.",
  "%a swears the vending machine is haunted.",
];

/** Wishes granted by the fountain -- flavour only, but they name a resident
 * so they read like the real thing. */
export const WISHES = [
  "%a wished for a quieter neighbour.",
  "%a wished to be taller. It did not work.",
  "%a wished for one more day off.",
  "%a wished everyone would stop asking.",
  "%a wished for a second breakfast.",
];

export function fill(template: string, a: string, b = ""): string {
  return template.replace(/%a/g, a).replace(/%b/g, b);
}

export function pick<T>(list: T[], roll: number): T {
  return list[Math.floor(roll * list.length) % list.length];
}
