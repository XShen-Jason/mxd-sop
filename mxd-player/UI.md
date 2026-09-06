# UI

The player page uses a dark game-inspired palette, compact labels, and clear
loading, empty, disabled, and error states. Copy is limited to labels and the
next action. Visual tokens live in `frontend-player/src/styles.css`; business
rules remain in the backend.

The player UI is mobile-first at narrow widths: forms and raid cards stack,
controls keep touch-friendly hit areas, long account names truncate safely, and
safe-area insets are respected on modern phones. Player character/server
pickers use a bounded listbox rendered in a viewport layer above page content;
its width is clamped to the viewport, its rows truncate long labels, and its
height and placement adapt when there is not enough room below the trigger.

Responsive smoke checks cover the verification, raid, and join pickers at
320x568, 390x844, 1024x600, and 1440x900; each listbox must remain inside the
viewport while the page keeps its original horizontal bounds.
