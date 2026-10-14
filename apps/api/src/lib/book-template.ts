/** The pages every new book starts with: front matter, one empty year, back matter. */
export function defaultBookPages(year: number) {
  return [
    { type: 'endpaper', themeId: 'cream' },
    { type: 'title', themeId: 'cream' },
    { type: 'index', themeId: 'cream' },
    { type: 'chapters', themeId: 'cream' },
    ...yearBlock(year),
    { type: 'closing', themeId: 'cream' },
    { type: 'backpaper', themeId: 'cream' },
  ].map((p, position) => ({ stickerPack: 'none', layout: null, label: null, year: null, header: null, ...p, position }));
}

/** A year block is a two-page summary spread. Matches the prototype's addYear(). */
export function yearBlock(year: number) {
  const label = `${year} in photos`;
  return [
    { type: 'summary', layout: 'summaryL', themeId: 'kraft', label, year, header: { kicker: 'Year in photos', title: String(year), subtitle: 'A year still being written' } },
    { type: 'summary', layout: 'summaryR', themeId: 'kraft', label, year, header: null },
  ];
}
