// Veyra — Phase 5 venue registry: exterior anchors, entrance geometry, labels.
// Single source of truth shared by buildCity (placement), PlayState (interaction
// items), TransitionSystem (entry choreography) and InteriorState (arrival).
export const VENUES = {
  casino: {
    id: 'casino',
    buildingId: 'casino',
    name: 'VEYRA CASINO',
    subtitle: 'Plinko · Slots · Dice · Heads & Tails',
    cx: 800, frontY: 2620,
    door:       { x: 800, y: 2618 },   // door line on the facade
    threshold:  { x: 800, y: 2630 },   // Lester's foot-of-stairs beat
    final:      { x: 800, y: 2622 },   // last kinematic pose before the fade
    approach:   { x: 800, y: 2716 },   // walk-in aim point
    exitSpawn:  { x: 800, y: 2716 },   // where Lester reappears on exit
    entrance:   { x: 800, y: 2686, radius: 72, label: 'Enter casino' },
    accent: '#ffd98a', accent2: '#d9a441',
  },
  arcade: {
    id: 'arcade',
    buildingId: 'arcade2',
    name: 'VEYRA ARCADE',
    subtitle: 'Arcade floor arriving soon',
    cx: 1800, frontY: 2620,
    door:       { x: 1800, y: 2618 },
    threshold:  { x: 1800, y: 2630 },
    final:      { x: 1800, y: 2622 },
    approach:   { x: 1800, y: 2716 },
    exitSpawn:  { x: 1800, y: 2716 },
    entrance:   { x: 1800, y: 2686, radius: 72, label: 'Enter arcade' },
    accent: '#8ff5ff', accent2: '#ff4fd8',
  },
};

export const VENUE_LIST = [VENUES.casino, VENUES.arcade];
