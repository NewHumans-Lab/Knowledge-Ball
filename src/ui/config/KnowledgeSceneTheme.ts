export const KNOWLEDGE_SCENE_THEME = {
  node: {
    inner: 0x66D9FF,
    middle: 0x3F7BFF,
    outer: 0x806CFF,
    core: 0xFFFFFF,
    structural: 0xF7FBFF,
    falsified: 0xEE5B63,
    // Semantic node bodies remain opaque presentation colors. Surface depth comes
    // from one shared neutral grayscale matcap, never from the central sun or page
    // backdrop, so every ordinary node receives the same relative 3D modulation.
    shellOpacity: 1.00,
    pointOpacity: 0.52,
    sphereWidthSegments: 24,
    sphereHeightSegments: 16,
    matcapLight: 255,
    // PR #76's first calibration (255/205/180) rendered at only ~8% regional
    // contrast on the real 390px mobile WebGL artifact. This stronger neutral ramp
    // is calibrated against that same artifact toward the requested 15-20% visible
    // light/dark difference while preserving semantic hue.
    matcapMid: 160,
    matcapDark: 120,
    selectedEmissiveIntensity: 0.30,
    baseEmissiveIntensity: 0.08,
  },
  renderer: {
    antialias: true,
    mobilePixelRatio: 1.25,
    desktopPixelRatio: 2,
  },
  mastery: {
    tint: 0xFFFFFF,
    coreStop: 'rgba(255,255,255,1)',
    touchedMidStop: 'rgba(226,242,255,.56)',
    masteredMidStop: 'rgba(255,255,255,.86)',
    edgeStop: 'rgba(255,255,255,0)',
    touchedOpacity: 0.70,
    masteredOpacity: 0.94,
    noneOpacity: 0,
  },
  edge: {
    normal: 0xB9D8F5,
    active: 0xD9ECFF,
    normalOpacity: 0.50,
    activeOpacity: 0.50,
    inactiveFactor: 1.00,
    falsifiedOpacity: 0.50,
    suspendedOpacity: 0.50,
    disputedOpacity: 0.50,
  },
  sun: {
    core: 0xFFFFFF,
    corona: 0x55ECFF,
    halo: 0x7C6CFF,
    coreOpacity: 0.96,
    // Keep the sun layered and luminous, but do not wash half of the phone viewport
    // in blue haze. The page backdrop supplies the broad deep-space field.
    innerGlowOpacity: 0.24,
    coronaOpacity: 0.18,
    haloOpacity: 0.10,
    innerGlowScale: 1.9,
    coronaScale: 3.8,
    haloScale: 5.5,
  },
} as const;

/**
 * Lightweight page backdrop derived from promo/remotion-ui-stills.
 *
 * It deliberately uses only static CSS gradients: no bitmap, no animation,
 * no extra canvas and no per-frame work. The Three.js canvas stays transparent
 * and remains responsible only for the knowledge graph itself.
 */
export const KNOWLEDGE_BACKGROUND_THEME = {
  center: 'rgba(16,24,64,.96)',
  mid: 'rgba(6,8,24,1)',
  deep: '#02030a',
  edge: '#000000',
  cyanNebula: 'rgba(42,128,255,.105)',
  violetNebula: 'rgba(124,108,255,.11)',
  coldMist: 'rgba(85,236,255,.04)',
  star: 'rgba(216,246,255,.62)',
} as const;

const BACKDROP_STYLE_ID = 'knowledge-ball-deep-space-backdrop';

export function installKnowledgeBackgroundTheme(): void {
  if (typeof document === 'undefined' || document.getElementById(BACKDROP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = BACKDROP_STYLE_ID;
  style.textContent = `
    html, body {
      background: ${KNOWLEDGE_BACKGROUND_THEME.edge};
    }

    .app {
      isolation: isolate;
      background:
        radial-gradient(circle at 50% 46%,
          ${KNOWLEDGE_BACKGROUND_THEME.center} 0%,
          ${KNOWLEDGE_BACKGROUND_THEME.mid} 34%,
          ${KNOWLEDGE_BACKGROUND_THEME.deep} 74%,
          ${KNOWLEDGE_BACKGROUND_THEME.edge} 100%);
    }

    .app::before,
    .app::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
    }

    .app::before {
      opacity: .54;
      background-image:
        radial-gradient(circle at center, ${KNOWLEDGE_BACKGROUND_THEME.star} 0, rgba(216,246,255,.42) .55px, transparent .9px),
        radial-gradient(circle at center, rgba(182,222,255,.48) 0, rgba(182,222,255,.30) .65px, transparent 1px),
        radial-gradient(circle at center, rgba(177,140,255,.38) 0, rgba(177,140,255,.22) .6px, transparent .95px),
        radial-gradient(circle at center, rgba(255,255,255,.34) 0, rgba(255,255,255,.20) .55px, transparent .9px);
      background-size: 149px 149px, 223px 223px, 317px 317px, 401px 401px;
      background-position: 17px 31px, 83px 127px, 151px 47px, 269px 191px;
    }

    .app::after {
      opacity: .92;
      background:
        radial-gradient(ellipse at 24% 32%, ${KNOWLEDGE_BACKGROUND_THEME.cyanNebula} 0%, rgba(42,128,255,0) 34%),
        radial-gradient(ellipse at 78% 66%, ${KNOWLEDGE_BACKGROUND_THEME.violetNebula} 0%, rgba(124,108,255,0) 38%),
        radial-gradient(ellipse at 52% 48%, ${KNOWLEDGE_BACKGROUND_THEME.coldMist} 0%, rgba(85,236,255,0) 46%),
        radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 54%, rgba(0,0,0,.58) 100%);
    }

    .app > .main {
      position: relative;
      z-index: 1;
    }
  `;
  document.head.appendChild(style);
}

installKnowledgeBackgroundTheme();

export type KnowledgeSceneTheme = typeof KNOWLEDGE_SCENE_THEME;
