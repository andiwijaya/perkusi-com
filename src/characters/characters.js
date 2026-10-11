// Original geometric cast: no reference artwork, copied icons or bitmap model.
export const characterDefinitions = [
  {
    role: "kick",
    name: "Bumi",
    color: "#edb97d",
    silhouette: "round pebble",
    body: "M38 65C34 30 58 16 84 25C110 33 120 79 100 104C76 127 41 110 38 65Z",
    accent:
      '<path d="M46 43 34 25 54 30M94 34 111 27 107 48"/><path d="M44 87 21 91M101 87 125 84" class="char-hand"/>',
    mouth: "M61 74C69 66 84 66 92 76C84 95 68 93 61 74Z",
  },
  {
    role: "snare",
    name: "Sabet",
    color: "#ec91a9",
    silhouette: "wide diamond kite",
    body: "M72 15 118 58 93 112 46 110 20 58Z",
    accent:
      '<path d="M28 52 8 40 14 71M111 52 136 44 130 78" class="char-hand"/><path d="M47 28 71 41 96 29"/>',
    mouth: "M49 76 97 72 85 91 61 94Z",
  },
  {
    role: "hat",
    name: "Cicik",
    color: "#9dd9bf",
    silhouette: "three leaf crown",
    body: "M63 114C50 97 39 68 50 49L48 15 70 32 92 12 91 48C106 69 92 94 82 112Z",
    accent:
      '<path d="M51 42 35 28M90 39 114 20"/><path d="M50 80 31 62M92 80 111 59" class="char-hand"/>',
    mouth: "M64 76 90 65 82 87 70 87Z",
  },
  {
    role: "vocal-bass",
    name: "Dum",
    color: "#acb1ef",
    silhouette: "tall double lobe",
    body: "M53 116C28 99 31 72 47 58C39 27 57 9 76 14C106 19 109 42 95 59C116 79 113 99 97 116Z",
    accent:
      '<path d="M47 67 28 76M103 68 123 76" class="char-hand"/><path d="M61 24 85 29"/>',
    mouth: "M56 73C67 63 89 63 98 76C91 105 64 105 56 73Z",
  },
  {
    role: "hum",
    name: "Luma",
    color: "#e4ce78",
    silhouette: "crescent petal",
    body: "M94 16C40 10 19 58 37 96C51 124 105 125 119 83C85 100 68 87 68 65C67 43 78 30 94 16Z",
    accent:
      '<path d="M44 43 32 17 57 26"/><path d="M42 87 18 98M102 103 123 115" class="char-hand"/>',
    mouth: "M45 75Q61 60 75 78Q68 87 54 84Z",
  },
  {
    role: "percussion-fx",
    name: "Tara",
    color: "#85cbdc",
    silhouette: "six armed star",
    body: "M73 11 87 35 115 26 111 57 135 75 105 89 107 119 77 105 48 120 43 93 13 82 36 60 30 31 58 36Z",
    accent:
      '<path d="M34 59 16 48M114 58 132 44" class="char-hand"/><path d="M64 22 72 40 81 23"/>',
    mouth: "M51 76Q73 62 94 75L78 97 64 91Z",
  },
];

export function characterSvg(role) {
  const c = characterDefinitions.find((character) => character.role === role);
  if (!c) throw new Error("Unknown character role");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" aria-hidden="true" focusable="false"><g class="char-body" fill="${c.color}" stroke="#243248" stroke-width="4" stroke-linejoin="round"><path d="${c.body}"/>${c.accent}<path d="M53 113 48 132 66 132M88 112 89 132 105 132"/><g class="char-eye" fill="#243248" stroke="none"><ellipse cx="58" cy="58" rx="4" ry="6"/><ellipse cx="89" cy="56" rx="4" ry="6"/></g><path class="char-mouth" d="${c.mouth}" fill="#243248"/><path class="char-tongue" d="M65 83Q76 77 85 84" fill="none" stroke="#fff2dd" stroke-width="3"/><circle class="char-status" display="none" cx="116" cy="116" r="11" fill="#fff2dd"/><path class="char-loading" display="none" d="M116 108a8 8 0 0 1 8 8" fill="none"/><path class="char-error" display="none" d="M116 110v7m0 3v1" stroke-width="3"/></g></svg>`;
}
