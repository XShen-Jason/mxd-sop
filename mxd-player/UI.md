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

The locked team history follows the registration and merge workflows as a
quiet, unframed section. It defaults to today's Boss rosters with a date input
and 44px previous/next/today controls. Member IDs wrap instead of truncating;
rosters have no invitation or mutation controls. Loading, empty and retry
states replace stale roster content during date changes.

History responsive checks cover 320x568, 390x844, 1024x600, and 1440x900,
including full rosters, long character IDs, date changes, empty dates and retry.

The date input uses the shared dark field styling with a native mobile date
picker. Application records stay visible above roster history under a Chinese
heading, show six recent results initially, and can expand to all returned
records (up to 50). Empty and loading states keep this entry discoverable.

Browser regression: with the frontend running, from the repository root run
`playwright-cli open http://127.0.0.1:6173`, then
`playwright-cli run-code --filename mxd-player/frontend-player/tests/history.browser.js`.
It uses mocked player responses without changing database records.

Above 980px, the registration workspace uses full-width sections with two
equal Boss columns and a separate current-team row. Application records and
locked rosters share an equal-width two-column history grid. Mobile retains
the original single-column reading order. Desktop overrides live in
`frontend-player/src/styles-desktop.css`.
