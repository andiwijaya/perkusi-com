import { extraPadNotes } from "../pads/extra-page.js";
import summaries from "./summaries.json" with { type: "json" };

const core = [
  [
    "drum",
    "Drum",
    "Drums",
    "percussion",
    [
      [
        "default",
        "Ruang",
        [
          "Kick",
          "Snare",
          "Closed hi-hat",
          "Open hi-hat",
          "Clap",
          "Tom",
          "Rim",
          "Shaker",
        ].map((label, i) => [
          [
            "kick",
            "snare",
            "closed-hat",
            "open-hat",
            "clap",
            "tom",
            "rim",
            "shaker",
          ][i],
          label,
        ]),
      ],
    ],
  ],
  [
    "bilah",
    "Bilah",
    "Bilah",
    "synthetic",
    [
      [
        "default",
        "D minor",
        ["d4", "f4", "g4", "a4", "c5"].map((n) => [n, n.toUpperCase()]),
      ],
    ],
  ],
  [
    "kendhang-ciblon",
    "Kendhang Ciblon",
    "Kendhang Ciblon",
    "gamelan",
    [
      [
        "default",
        "Tak · Thung",
        [
          ["tak", "Tak"],
          ["thung", "Thung"],
        ],
      ],
    ],
  ],
  [
    "bass-elektrik",
    "Bass elektrik",
    "Electric bass",
    "strings",
    [
      [
        "default",
        "E1 · G1 · B1",
        ["e1", "g1", "b1"].map((n) => [n, n.toUpperCase()]),
      ],
    ],
  ],
  [
    "gitar-nylon",
    "Gitar nylon",
    "Nylon guitar",
    "strings",
    [
      [
        "default",
        "B2 · E3 · G3",
        ["b2", "e3", "g3"].map((n) => [n, n.toUpperCase()]),
      ],
    ],
  ],
];
const extras = [
  ["kethuk", "Kethuk"],
  ["kempyang", "Kempyang"],
  ["kenong", "Kenong"],
  ["bonang-panerus", "Bonang panerus"],
  ["peking", "Peking"],
  ["saron-barung", "Saron barung"],
  ["bonang-barung", "Bonang barung"],
  ["demung", "Demung"],
  ["kempul", "Kempul"],
  ["gong-ageng", "Gong ageng"],
  ["slenthem", "Slenthem"],
].map(([slug, name]) => [
  slug,
  name,
  name,
  "gamelan",
  Object.entries(extraPadNotes)
    .filter(([key]) => key === slug || key.startsWith(slug + "-"))
    .map(([key, g]) => [
      key,
      key.endsWith("-pelog")
        ? "Pelog"
        : key.endsWith("-slendro")
          ? "Slendro"
          : name,
      g.notes,
    ]),
]);

export const instruments = [...core, ...extras].map(
  ([slug, id, en, category, banks]) => ({
    slug,
    page: "instrument-" + slug,
    id,
    en,
    category,
    summary: summaries[slug],
    image: "/images/instruments/" + slug + ".webp",
    banks: banks.map(([key, label, notes]) => ({ key, label, notes })),
    count: banks.reduce((n, bank) => n + bank[2].length, 0),
  }),
);
export const instrumentBySlug = (slug) =>
  instruments.find((i) => i.slug === slug);
export const instrumentByPage = (page) =>
  instruments.find((i) => i.page === page);
export const isInstrumentPage = (page) =>
  page === "instruments" || !!instrumentByPage(page);
