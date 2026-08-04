/**
 * The HUD subsystem.
 *
 * Construct one `Hud`, feed it a `HudModel` every frame, and render it last.
 * Nothing else in the game needs to know anything about canvases or layers.
 */

export { Hud } from './Hud';
export type { HudOptions } from './Hud';

export { MenuScreen, CountdownWidget, DEFAULT_MENU_ITEMS } from './Menus';
export type { MenuKind, MenuState, ReplayFrameRect } from './Menus';

export {
  Widget,
  RouteProfileWidget,
  ClockWidget,
  SpeedWidget,
  PlaceWidget,
  BoostWidget,
  StandingsWidget,
  PopupWidget,
  CornerWidget,
  WarningWidget,
  clockString,
} from './Widgets';

export { HudCanvasRoot, HudLayer, SolidQuad, css, cssA, cssMix } from './HudCanvas';
export type { Anchor, LayerPlacement } from './HudCanvas';

export { drawText, drawWordmark, measureText, buildTypeface } from './Typeface';
export type { TextStyle } from './Typeface';
