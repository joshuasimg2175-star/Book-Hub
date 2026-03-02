# BookHub Stability Checklist

Use this checklist before sharing a build.

## 1) Automated smoke checks

- [ ] Run `CI=true npm test -- --watchAll=false`
- [ ] Run `npm run build`
- [ ] Confirm both commands pass with no failures

## 2) Desktop web checks

- [ ] Open app on desktop width (`>= md`)
- [ ] Click hamburger (top-right) and confirm Settings drawer opens from the side
- [ ] Confirm drawer close works via backdrop click and close button
- [ ] Scroll inside the Settings drawer from top to bottom
- [ ] Switch between at least 3 themes and confirm text is readable in Settings
- [ ] Confirm Home and Friends routes still work while drawer is closed

## 3) Mobile layout checks

- [ ] Open app on mobile width (`< md`)
- [ ] Confirm bottom nav shows `Home` and `Friends` with moving slider pill
- [ ] Confirm top bar still shows app logo/name + `Sign In` + `Settings`
- [ ] Confirm no horizontal overflow on Home, Friends, and Settings

## 4) Home page checks

- [ ] Toggle `Add a Book` section (expand/collapse) and confirm animation + state persistence
- [ ] Search books by title and author
- [ ] Switch category tabs (`All`, `Finished`, `Currently reading`, `Didn't finish`, `Wishlist`)
- [ ] Switch list/grid modes and refresh page; confirm default view persists
- [ ] Change a book status and confirm Home metrics update

## 5) Add Book + scanner checks

- [ ] ISBN add: enter a valid ISBN and confirm title/cover/summary populate
- [ ] Manual add: create a book and confirm it appears in library
- [ ] Camera scanner: confirm preview opens
- [ ] Live scan (if browser supports it): detect barcode and show result popup
- [ ] Photo scan: choose image with barcode and confirm detection path works
- [ ] After successful detection, confirm category prompt appears and adding works
- [ ] Confirm manual barcode input still works when scan fails

## 6) Friends page checks

- [ ] Add a friend using new `Add friend by name` input
- [ ] Confirm success notice appears and friend shelf is selected
- [ ] Timeline filters (friend + status + search) produce expected results
- [ ] `Add to Wishlist` from timeline and friend shelf updates Home wishlist count

## 7) Data management checks

- [ ] Export library creates a JSON file
- [ ] Import same file restores books successfully
- [ ] `Delete All Books` clears Home list and updates Settings stats

## 8) Theme-specific visual checks

- [ ] Antique Paper theme looks paper-native (no liquid-glass treatment)
- [ ] Dark themes: all Settings labels and controls remain readable
- [ ] Light themes: contrast remains readable on cards, chips, and buttons

## Quick regression log template

- Area:
- Device/Browser:
- Steps to reproduce:
- Expected:
- Actual:
- Screenshot/video:
