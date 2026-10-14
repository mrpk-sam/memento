/** Landing copy above the shelf. A blank field in Settings falls back to these defaults. */
export function landingDefs(family: string): [key: string, label: string, def: string][] {
  return [
    ['kicker', 'Kicker', `The ${family} family library`],
    ['head', 'Headline', 'Every year, bound and kept.'],
    ['intro', 'Intro', 'Birthdays, recipes and road trips, one book for each household. Pull one off the shelf to start reading.'],
    ['btn1', 'Main button', 'Open a book'],
    ['btn2', 'Second button', "Editor's Desk"],
  ];
}

export function landingText(family: string, landing: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, , d] of landingDefs(family)) out[k] = (landing[k] ?? '').trim() || d;
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "today", or "Jan 2" like the prototype's nameplate. */
export function updatedLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}
