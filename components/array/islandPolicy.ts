/**
 * Compatibility shim. The policy moved to components/ui/tabBarPolicy.ts when
 * IslandNav was replaced by the v3 TabBar (components/ui/TabBar.tsx). Every
 * name below is a straight re-export under its old name, so IslandNav.tsx and
 * islandPolicy.test.ts keep working unchanged until a later cleanup deletes
 * them. Behavior is identical — see tabBarPolicy.ts for the implementation
 * and tabBarPolicy.test.ts for the ported tests.
 */
export type { TabSlot as IslandSlot, TabBarAudience as IslandAudience } from '@/components/ui/tabBarPolicy'
export {
  tabBarSlots as islandSlots,
  isTabBarHidden as isIslandHidden,
  isTabBarScrollRevealed as isIslandScrollRevealed,
  activeSlotHref,
} from '@/components/ui/tabBarPolicy'
