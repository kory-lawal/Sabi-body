# SabiBody Buddies: final report

_Date: 21 Nov 2026. Shipped in [PR #2](https://github.com/kory-lawal/Sabi-body/pull/2), with follow-up fixes in [PR #3](https://github.com/kory-lawal/Sabi-body/pull/3). Both are merged to `main` and deployed._

## 1. Summary
Buddies is now a social layer on top of the existing camera workout. Friends can find each other, plan workouts, work out side by side on camera, keep shared streaks, chat, nudge and challenge each other. Everything runs on the existing stack: Vite with plain JS, FastAPI, Neon Postgres and MediaPipe. There is no Supabase and no Next.js. Single-player workouts are unchanged.

## 2. Deployment state
| Piece | State |
|---|---|
| Neon (prod, "sabibody", Ohio) | Migrated `0001 → 0002`. First dry-run on branch `buddies-dryrun` (upgrade, schema check, downgrade and upgrade again). The branch auto-deletes on 22 Nov. All 4 existing users got unique usernames. |
| Render API | Redeployed from `main`. New routes are live and `/api/health` is OK. |
| Vercel (www.sabibody.fit) | New bundle is live and connects to `wss://sabi-body-1.onrender.com/api/ws`. |
| WebSocket origin check | Allowed origins connect; other origins get HTTP 403 (checked live). |
| Video relay (TURN) | Metered free trial (500 MB of relay data), workspace `sabibody`, credential `sabibody-production`. Render has `METERED_TURN_APP` and `METERED_TURN_API_KEY`, and `/api/rtc/ice-servers` returns `relay: "metered"`. |

## 3. What shipped (one commit per phase)
1. **Friends.** Usernames are generated at signup and can be changed once a week. You can search by username (email is never exposed), send, accept, decline and cancel requests (with a re-request cooldown), remove friends, block (works both ways and is invisible to the blocked person), report (optionally blocking too), and mute.
2. **Realtime and notifications.** Each tab has one authenticated WebSocket. The token goes in the first frame, never in the URL. The socket also has an origin check, heartbeat, expiry warning with in-place refresh, and is closed on logout. The notification centre has per-type in-app and email preferences.
3. **Chat.** Private 1:1 messages, exercise cards, nudges with presets and limits, read state, a typing indicator, and idempotent sends.
4. **Invitations and calendar.**
   - Shared workouts can be instant (30-minute expiry) or scheduled.
   - Either person can suggest another time.
   - The calendar has month, week, upcoming, past and cancelled views, all shown in local time.
   - Reminder emails go out 1 hour before and at start time, plus optionally 24 hours before. They are claim-then-send, so there are no duplicates, and a reschedule sets them up again.
   - A 60-second background job runs inside the API, with the GitHub cron as a backup.
5. **Workout Together.**
   - A side-by-side WebRTC room. Each device runs its own MediaPipe and counts only its own reps.
   - Both people press ready, then a synced countdown starts. The room shows live progress for both, cheers, and camera and mic toggles.
   - If someone drops, there is a 3-minute reconnect grace.
   - Repeat rounds need both people to agree.
   - Each person saves their own workout, linked to the session, and both get a joint summary.
6. **Streaks.** Buddy and per-exercise streaks with milestones at 3, 7, 14, 30, 50 and 100. The rules are enforced on the server (see 5), and no API can write streak values.
7. **Challenges.** One-to-one goals by reps, longest hold or workout count, with a deadline. Progress is computed only from real saved workouts inside the challenge window.
8. **Dashboard and polish.**
   - A Buddies hub with quick actions, invitations, upcoming workouts, streaks, challenges, friends with online status, and friends' recent activity.
   - A live "friend is waiting in your room" banner.
   - A one-line nav with a 🔔.
   - Checked at 375, 768 and 1280 px widths.

## 4. Architecture decisions
- **Video is direct peer-to-peer WebRTC, not an SFU** (a central media server). For two people an SFU adds cost and a vendor without any benefit. ICE servers come from `/api/rtc/ice-servers`.
- **Postgres is the source of truth.** The in-memory socket registry only delivers messages. Events are published after the database commit, and reconnecting rebuilds room state from the database.
- **Vercel can't proxy WebSockets**, so the browser connects to Render directly. Local dev uses the Vite proxy.
- **Rep counting stays on each device.** Only progress numbers cross the network, so counters keep working even if the video connection fails.

## 5. Streak rules (shown to users in the app)
| Situation | Streak |
|---|---|
| Both completed a workout linked to the session | +1 |
| Mutual reschedule, a cancel more than 2 hours before, or an instant invite cancelled before it starts | No change |
| Late cancel (under 2 hours), no-show (not joined within 30 minutes), or joined but didn't finish | Resets to 0 |
| Disconnected and didn't come back within 3 minutes | No change |
| Declined or expired before acceptance | Not counted as a commitment |

Repeat rounds count toward totals and challenges but never add streak days.

## 6. Security and privacy
- **Access control.** Every route and the socket require auth. Chat, invites and challenges require friendship. Room signalling is limited to the room's participants. Users can only write their own workout rows.
- **Rate limits** on search, friend requests (20 per day plus a 7-day cooldown), nudges, chat and ICE. WebSocket frames are capped at 16 KB.
- **Secrets.** TURN secrets stay on the server and nothing is recorded or stored. All user text is escaped before display.
- **Block.** Blocking hides both people from each other and cancels any open items between them.

## 7. Tests
- **Backend:** 76 unittest cases against real Postgres, all passing. They cover state machines, privacy, reminders with a fixed clock, streak scenarios, challenge progress, and WebSocket auth, rooms and relay.
- **Frontend:** 277 `node --test` cases, all passing (including 1 added in PR #3). The 242 that existed before Buddies still pass.
- **Build:** the production build is clean, and the dev-only fake camera is stripped from the bundle.

## 8. Verified
- Two separate browsers on the local stack, both using the fake camera:
  - friend flow and chat
  - invite, accept and join the room
  - both video feeds connect, each mirrored correctly
  - cheers, ready on both sides and a synced start
  - disconnect, "reconnecting…" and rejoin
  - leave
  - live calendar and notification updates
- Chrome's built-in fake camera, which uses the real camera path, at desktop and phone sizes with strict autoplay: live audio and video on both sides.
- Mobile layout: no sideways scrolling on any Buddies page.
- Live production, with two throwaway test accounts (deleted afterwards):
  - friend request, invite and room
  - both sides received the other's audio and video at 640×480, and the status read "Connected"
  - no sign-in errors
- Relay-only test on production: with direct connections disabled, video and audio both came through the Metered relay (over TCP).
- **Real devices, across networks (you tested it):** iPhone ↔ laptop and Android ↔ laptop, camera and mic working both ways.

## 9. Issues found after launch, and their fixes
- **No partner video or audio across networks.** Production had no TURN relay, so phone ↔ laptop calls on different networks couldn't exchange media. Fixed by setting up Metered TURN.
- **Sign-in renewal returned 409, then logged people out.** If a renewal response never reached the browser (for example Vercel timing out while Render woke up), the server had already rotated the cookie. Every retry was refused, and after 30 seconds the replay was treated as token theft, revoking every session. Fixed: a just-rotated token is now redeemed again within the 30-second window, and replays after it are still treated as theft.
- **Render drops custom WebSocket close codes**, so a 4401 arrived as 1006. Fixed in the client: a socket that closes before "ready" now refreshes the token and retries.
- **Flaky WebSocket timing in tests.** The server loop timed out every 20 seconds on receive. Replaced with a blocking receive plus a watchdog task.

## 10. Known limits
- **Relay data:** the Metered free trial includes 500 MB, roughly 1–2 hours of relayed video. Only calls that can't connect directly use it. Watch **Usage analytics** in Metered and upgrade if you run low.
- **Render free plan:**
  - The server sleeps when idle, so the first request takes about 50 seconds.
  - It runs a single process, so the socket registry is in memory. A redeploy drops live rooms, and they recover when people rejoin.
  - Reminders are only precise while the server is awake. The GitHub cron backup can run 5–20 minutes late.
- **Not yet verified:**
  - Rep counting with real cameras in a long shared workout.
  - Buddy reminder emails sent through Resend in production.
- **Echo:** the room recommends headphones, because there's no echo cancellation beyond the browser's own.

## 11. Next steps (optional)
1. Upgrade Render to Starter (about $7/month) so it doesn't sleep. Reminders become on time and cold-start delays go away.
2. Do a full two-person workout to the target with real cameras, and confirm both results save and the streak updates.
3. Check that a scheduled workout's reminder email arrives.
4. Delete the merged `feature/buddies` and `fix/ws-proxy-close` branches.
