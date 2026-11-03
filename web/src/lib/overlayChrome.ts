// While an overlay owns the screen (replay, war pane, war cinematic, history
// sweep), the app keeps two pills in the top corners: the BattleSight home
// pill at the top left and the Support Ukraine button at the top right.
// Overlay chrome keeps clear of both with these offsets.

// OVERLAY_ROW_TOP is the top edge of both corner pills, in px.
export const OVERLAY_ROW_TOP = 12;

// OVERLAY_BAND is the height of the top band the corner pills own, in px.
// Overlay chrome that spans the width starts below it.
export const OVERLAY_BAND = 64;

// OVERLAY_HOME_CLEARANCE is the left inset that clears the home pill, in px.
export const OVERLAY_HOME_CLEARANCE = 184;

// OVERLAY_DONATE_CLEARANCE is the right inset that clears the Support Ukraine
// button, in px.
export const OVERLAY_DONATE_CLEARANCE = 166;
