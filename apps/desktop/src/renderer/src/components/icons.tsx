import type { JSX } from 'react';

/** One stroke weight, one cap style, one grid. */
const s = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const Back = (): JSX.Element => (
  <svg {...s}><path d="M15 18l-6-6 6-6" /></svg>
);

export const Forward = (): JSX.Element => (
  <svg {...s}><path d="M9 18l6-6-6-6" /></svg>
);

export const Reload = (): JSX.Element => (
  <svg {...s}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
);

export const Gear = (): JSX.Element => (
  <svg {...s}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.2 14.6a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-2.55 1.06V20a1.8 1.8 0 1 1-3.6 0v-.08A1.5 1.5 0 0 0 8.9 18.5a1.5 1.5 0 0 0-1.65.3l-.05.05A1.8 1.8 0 1 1 4.65 16.3l.05-.05a1.5 1.5 0 0 0-1.06-2.55H3.5a1.8 1.8 0 1 1 0-3.6h.08A1.5 1.5 0 0 0 5.5 8.9a1.5 1.5 0 0 0-.3-1.65l-.05-.05A1.8 1.8 0 1 1 7.7 4.65l.05.05a1.5 1.5 0 0 0 1.65.3h.07A1.5 1.5 0 0 0 10.4 3.6V3.5a1.8 1.8 0 1 1 3.6 0v.08a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.1a1.8 1.8 0 1 1 0 3.6h-.08a1.5 1.5 0 0 0-1.37.91z" />
  </svg>
);

/** Expand the page to fill the window. */
export const Expand = (): JSX.Element => (
  <svg {...s}><path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" /></svg>
);

export const Collapse = (): JSX.Element => (
  <svg {...s}><path d="M4 10h4a2 2 0 0 0 2-2V4M20 10h-4a2 2 0 0 1-2-2V4M4 14h4a2 2 0 0 1 2 2v4M20 14h-4a2 2 0 0 0-2 2v4" /></svg>
);

export const Send = (): JSX.Element => (
  <svg {...s} strokeWidth={2.1}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);

export const Square = (): JSX.Element => (
  <svg {...s} fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
);

export const Hand = (): JSX.Element => (
  <svg {...s} width={13} height={13}>
    <path d="M18 11V6a1.5 1.5 0 0 0-3 0M15 11V4.5a1.5 1.5 0 0 0-3 0V11M12 11V6a1.5 1.5 0 0 0-3 0v8" />
    <path d="M9 12.5L7.2 10a1.5 1.5 0 0 0-2.4 1.8L8 17a6 6 0 0 0 10-4.5V11" />
  </svg>
);

export const Shield = (): JSX.Element => (
  <svg {...s} width={13} height={13}>
    <path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" />
  </svg>
);

export const Lock = (): JSX.Element => (
  <svg {...s} width={10} height={10} strokeWidth={2.6}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
