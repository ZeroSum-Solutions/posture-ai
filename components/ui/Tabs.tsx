/**
 * Content-pane tabs (Findings | Program, Overview | History). Same visual
 * track as SegmentedControl, but `role=tablist` with panels — use this for
 * a page's content panes, SegmentedControl for an inline mode toggle that
 * changes a view in place.
 *
 * This re-exports `components/array/Tabs` (`TabStrip`) under the v3 name
 * rather than reimplementing it: that file owns the full ARIA contract
 * (ids, roving tabindex, arrow/Home/End) that e2e and unit tests already
 * depend on (components/array/Tabs.test.tsx), and it has been restyled in
 * place to the v3 segmented look. Keep this file's props identical to
 * TabStrip's — do not fork the implementation.
 */
export {
  TabStrip as Tabs,
  tabId,
  tabPanelId,
  tabPanelProps,
  type TabOption,
} from '../array/Tabs'
