# Keeper Log

A simple goalkeeper match tracker for grassroots football. Tap a big button each time the keeper makes a save, concedes, distributes or claims a cross. After the match you get the save %, distribution % and clean sheets, plus a Progress screen showing how they're getting on over the season.

It's a single static web page. There's no install, no account and no server.

## On the touchline

1. Open the app and tap **+ New match**. Type the opponent (optional) and tap **Start match**.
2. Tap the **clock** at kick-off. Tap it again to pause at half-time.
3. Tap **Save**, **Goal conceded**, **Good dist.**, **Bad dist.** or **Cross claimed** as it happens.
   - Only count a save if the shot would have gone in without the keeper.
   - After a goal you're asked "Could they have saved it?" Answer it, or ignore it and it skips itself after 5 seconds.
   - Mis-tapped? **Undo** removes the last thing you logged.
4. Tap **Finish match** at full time to see the summary.

If the phone locks or the page reloads, nothing is lost and the clock keeps the right time.

### Add it to your home screen

- **iPhone (Safari):** tap the Share button, then **Add to Home Screen**.
- **Android (Chrome):** tap the ⋮ menu, then **Add to Home screen** (or **Install app**).

It then opens full screen like a normal app.

## Your data stays on the phone

Matches are saved only in this browser on this phone. Nothing is uploaded anywhere. That also means that if the phone is lost, reset, or the browser's data is cleared, the matches are gone.

So go to **Settings → Download backup** every few weeks and before changing phones. To move to a new phone, open the app there and use **Restore from backup** with that file.

## Hosting on GitHub Pages

1. Push these files to the `main` branch of a GitHub repository.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and save.
4. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## Running it locally

Just open `index.html` in a browser. There's nothing to build or install.

To try the Progress screen, go to **Settings** and tap **Load demo data** at the bottom (this replaces any matches on the phone, after asking).

## Files

- `index.html`: page shell and home-screen app tags
- `app.js`: all the logic; the pure functions (`stats`, `validateBackup`, `formatClock`, `progress`) are at the top
- `styles.css`: the "Paper" design
- `manifest.json`, `icon.svg`: home-screen app details
