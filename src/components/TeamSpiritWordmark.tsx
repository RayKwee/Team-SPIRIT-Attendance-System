import type { SVGProps } from 'react';

interface WordmarkGlyph {
  id: string;
  fill: string;
  d: string;
}

/**
 * Custom 24-unit integer-grid glyphs matching the exact blocky geometry,
 * proportions, and multi-color sequence of the official Team SPIRIT wordmark.
 */
const WORDMARK_GLYPHS: WordmarkGlyph[] = [
  { id: 'team-t', fill: '#a9d96f', d: 'M0 0H20V4H12V24H8V4H0Z' },
  {
    id: 'team-e',
    fill: '#e2c62c',
    d: 'M22 10H23V8H25V6H35V8H37V10H38V14H34V15H26V20H34V18H38V20H37V22H35V24H25V22H23V20H22ZM26 10V12H34V10Z',
  },
  {
    id: 'team-a',
    fill: '#d62d1e',
    d: 'M40 6H53V8H56V9H57V24H43V22H41V21H40V16H41V15H43V13H53V10H40ZM44 16V20H53V16Z',
  },
  {
    id: 'team-m',
    fill: '#43b9d9',
    d: 'M59 8H61V6H71V8H75V6H84V8H87V24H83V10H75V24H71V10H63V24H59Z',
  },
  {
    id: 'spirit-s',
    fill: '#d24135',
    d: 'M98 4H100V2H102V0H114V4H102V8H111V10H113V11H116V20H113V22H111V24H100V22H99V20H112V12H102V10H100V9H99V8H98Z',
  },
  {
    id: 'spirit-p',
    fill: '#e6c532',
    d: 'M119 0H135V3H137V4H138V10H137V11H135V14H123V24H119ZM123 4V10H133V9H134V5H133V4Z',
  },
  { id: 'spirit-i1', fill: '#a3d873', d: 'M142 0H150V4H148V20H150V24H142V20H144V4H142Z' },
  {
    id: 'spirit-r',
    fill: '#45bad3',
    d: 'M153 0H171V3H173V4H174V10H173V11H171V14H169V17H173V21H176V24H172V21H168V17H164V14H157V24H153ZM157 4V10H169V9H170V5H169V4Z',
  },
  { id: 'spirit-i2', fill: '#d24135', d: 'M180 0H188V4H186V20H188V24H180V20H182V4H180Z' },
  { id: 'spirit-t', fill: '#ecca34', d: 'M191 0H211V4H203V24H199V4H191Z' },
];

/** Scalable crisp-edge SVG vector wordmark for the Team SPIRIT header title. */
export function TeamSpiritWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 211 24"
      preserveAspectRatio="xMinYMid meet"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      {WORDMARK_GLYPHS.map((glyph) => (
        <path key={glyph.id} d={glyph.d} fill={glyph.fill} />
      ))}
    </svg>
  );
}
