// Original code-native illustrations; descriptive silhouettes, not authenticity evidence.
export function instrumentArt(instrument) {
  let shapes;
  if (["gong-ageng", "kempul"].includes(instrument))
    shapes =
      '<path d="M20 12H100M27 12V86M93 12V86" stroke="#44654c" stroke-width="6"/><circle cx="60" cy="46" r="30" fill="#b9a458" stroke="#746839" stroke-width="4"/><circle cx="60" cy="46" r="9" fill="#d6c685"/>';
  else if (instrument === "kendhang-ciblon")
    shapes =
      '<path d="M27 18Q9 48 27 77L96 67Q109 48 96 28Z" fill="#715040"/><ellipse cx="27" cy="48" rx="15" ry="29" fill="#d4c29c"/><ellipse cx="96" cy="48" rx="10" ry="20" fill="#ad9e79"/><path d="M37 24L82 63M37 70L82 31M49 20L61 70M71 22L49 71" stroke="#e1d0ac" stroke-width="2"/>';
  else if (
    [
      "bonang-barung",
      "bonang-panerus",
      "kenong",
      "kethuk",
      "kempyang",
    ].includes(instrument)
  )
    shapes =
      '<path d="M14 76H108M21 76L17 88M101 76L105 88" stroke="#44654c" stroke-width="7"/>' +
      [27, 61, 95]
        .map(
          (x) =>
            `<ellipse cx="${x}" cy="57" rx="16" ry="15" fill="#b9a458"/><ellipse cx="${x}" cy="49" rx="14" ry="8" fill="#dac986"/><circle cx="${x}" cy="45" r="5" fill="#88723e"/>`,
        )
        .join("");
  else
    shapes =
      '<path d="M12 72H108M20 72L14 89M99 72L105 89" stroke="#44654c" stroke-width="7"/>' +
      [20, 35, 50, 65, 80, 95]
        .map(
          (x, i) =>
            `<rect x="${x}" y="${28 + (i % 2) * 4}" width="13" height="40" rx="3" fill="#c6b66c" stroke="#8c7d44"/>`,
        )
        .join("");
  return `<svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
