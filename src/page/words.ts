// The translation card (R3) — DOM over the canvas, never in it. Each āyah's translation appears
// on its own beat after the light has passed along the words (chapters/story.ts decides when: a
// pure function of the ink clock); this only draws it. Translation: Abdullah Yusuf Ali, 1934, with
// his capitalisation and punctuation as printed (v1's choice, kept).

export const AYAT: ReadonlyArray<{ n: string; en: string }> = [
  { n: '١', en: 'In the name of Allah, Most Gracious, Most Merciful.' },
  { n: '٢', en: 'Praise be to Allah, the Cherisher and Sustainer of the Worlds;' },
  { n: '٣', en: 'Most Gracious, Most Merciful;' },
  { n: '٤', en: 'Master of the Day of Judgment.' },
  { n: '٥', en: 'Thee do we worship, and Thine aid we seek.' },
  { n: '٦', en: 'Show us the straight way,' },
  { n: '٧', en: 'The way of those on whom Thou hast bestowed Thy Grace, those whose (portion) is not wrath, and who go not astray.' },
];

export class Words {
  private readonly card: HTMLElement;
  private readonly num: HTMLElement;
  private readonly text: HTMLElement;
  private shown = 0;
  private lastOpacity = -1;

  constructor() {
    this.card = document.getElementById('words') as HTMLElement;
    this.num = this.card.querySelector('.n') as HTMLElement;
    this.text = this.card.querySelector('.t') as HTMLElement;
  }

  /** Show āyah `ayah` (1–7) at `opacity`; 0 hides the card. The text only changes while hidden. */
  update(ayah: number, opacity: number): void {
    const o = Math.round(opacity * 100) / 100;
    if (ayah > 0 && ayah !== this.shown && (this.lastOpacity <= 0 || this.shown === 0)) {
      const a = AYAT[ayah - 1]!;
      this.num.textContent = a.n;
      this.text.textContent = a.en;
      this.card.setAttribute('aria-label', `Āyah ${ayah}`);
      this.shown = ayah;
    }
    if (o === this.lastOpacity) return;
    this.lastOpacity = o;
    this.card.style.opacity = String(o);
    // a gentle rise as it arrives
    this.card.style.transform = `translate(-50%, ${((1 - o) * 8).toFixed(1)}px)`;
    this.card.classList.toggle('is-on', o > 0);
    this.card.setAttribute('aria-hidden', o > 0.5 ? 'false' : 'true');
  }
}
