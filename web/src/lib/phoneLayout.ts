// Phone chrome sits in fixed rows: the masthead, the search box, a third
// header row with the mode rail on the left and the landing toggle on the
// right, and a bottom row of chips above the timeline. Every tap target in
// those rows is at least 44 px tall.

// PHONE_ROW3_TOP is the top edge of the third header row, in px.
export const PHONE_ROW3_TOP = 122;

// PHONE_ROW3_HEIGHT is the height of the third header row, in px: a 44 px
// target plus the landing toggle's padding and border.
export const PHONE_ROW3_HEIGHT = 50;

// PHONE_CHIP_ROW_BOTTOM is the CSS bottom offset of the chip row that sits
// above the timeline, clear of the home indicator.
export const PHONE_CHIP_ROW_BOTTOM = 'calc(116px + env(safe-area-inset-bottom, 0px))';
