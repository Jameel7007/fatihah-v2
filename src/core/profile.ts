// Render profile — chosen ONCE at boot and never changed during a session (v1 lesson: tier
// demotion, DPR changes and resizes showed mid-scroll). Phone first: the phone profile is the
// design target, the larger profiles only spend more on the same picture.
//
//   phone   — touch device with a phone-sized short side. The review device at every milestone.
//   laptop  — any other touch device, or a fine pointer on a laptop-class screen.
//   desktop — fine pointer on a large screen.
//
// `?profile=phone|laptop|desktop` overrides (headless emulation cannot fake screen.width).

export type ProfileName = 'phone' | 'laptop' | 'desktop';

export interface Profile {
  name: ProfileName;
  /** device pixels per CSS pixel, at most */
  dprCap: number;
  /** key-light shadow map edge (texels) */
  shadowMap: number;
  /** shadow filter: blocker-search taps (0 = fixed-radius PCF) and filter taps */
  shadowBlockerTaps: number;
  shadowFilterTaps: number;
  /** the parchment's inertia layer (residual sim) */
  residual: boolean;
  /** particle budget multiplier (R1+: dust, motes, sparks) — the first thing a phone scales down */
  particles: number;
  /** touch layout: canvas sized to 100svh, scroll measured against 100lvh (toolbar-proof) */
  touch: boolean;
}

const PROFILES: Readonly<Record<ProfileName, Omit<Profile, 'name' | 'touch'>>> = {
  phone: { dprCap: 1.75, shadowMap: 1024, shadowBlockerTaps: 0, shadowFilterTaps: 5, residual: false, particles: 0.35 },
  laptop: { dprCap: 2.0, shadowMap: 2048, shadowBlockerTaps: 8, shadowFilterTaps: 13, residual: true, particles: 0.7 },
  desktop: { dprCap: 2.0, shadowMap: 2048, shadowBlockerTaps: 16, shadowFilterTaps: 25, residual: true, particles: 1 },
};

export function chooseProfile(query: URLSearchParams): Profile {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const forced = query.get('profile');
  let name: ProfileName;
  if (forced === 'phone' || forced === 'laptop' || forced === 'desktop') name = forced;
  else if (coarse) name = Math.min(screen.width, screen.height) < 600 ? 'phone' : 'laptop';
  else name = Math.max(screen.width, screen.height) >= 1900 ? 'desktop' : 'laptop';
  return { name, touch: coarse || name === 'phone', ...PROFILES[name] };
}
