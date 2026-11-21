---
name: effort-switch
description: |
  Switch the reasoning threshold (`thinking_effort`) of a Mavis session between
  `low`, `medium`, `high`, `xhigh` and `max`. Use this skill whenever the user asks to
  change the level of reasoning — "поставь effort на max", "переключи на минимальный",
  "switch to high", "смени уровень размышлений" — names a target session
  ("переведи сессию 465… на low"), or asks which level fits a kind of work. Do NOT use it
  to measure or compare the quality of two thresholds (that is an evaluation task), to
  change the model itself, or when "reasoning" appears only in the prose of the request.
  Opening the skill always starts with a card of the five levels: the current threshold and
  the recommended one are shown, and the threshold is applied only after the user answers.
---

# Effort Switch — switching the reasoning threshold

## Inputs to collect

- **The threshold** — one of `low`, `medium`, `high`, `xhigh`, `max`. Map the user's wording
  («на максимум», «поменьше») onto the list; if the wording is ambiguous — ask.
- **Which session** — by default the current one (`session_id: "me"`). Change another one only
  if the user named its id or said «в той сессии, где…».
- **Consent** — the threshold decides how every following turn is produced, so the choice belongs
  to the user (`AGENTS.md` §5 — every decision belongs to the user). The card is the first action
  of this skill, not a fallback: even when the user named a level, the card is shown with that
  level marked, and the threshold is applied only after the answer.
- **The current threshold** — read it before the card (`session_get`), so the card can show what
  it is now. If the session cannot be read, the card still goes out; the current value is simply
  not shown.

## Level policy — what to recommend

| Kind of work | Recommended |
| --- | --- |
| mechanical edits, renames, single-step operations | `low` |
| breadth-first ideation (`Brainstormer`) | `medium` |
| authoring a skill, drafting a document, review cycles (`skill-creator`) | `high` |
| technical audit of a session or a codebase (`session-audit`) | `high` |
| system-level planning and design decisions (`plan-mode`) | `xhigh` |
| autonomous implementation end to end (`mini-coder-max`) | `max` |

Reason: deeper reasoning costs more, and each workflow above needs a different depth. Put the
value from this table on the recommended option of the card — the recommendation is a
recommendation, not a default to apply silently.

## Procedure

1. **Read the current blob.** `session_get` with `session_id` (the current one is `"me"`). What
   is needed is exactly `extra_data_json`, whole.
   Reason: `session_update` replaces `extra_data_json` **entirely**, it does not merge. If the
   blob is assembled from scratch, `query`, `team_policy`, `device_platform`, `model_resolution`
   and the other session settings silently disappear. The same read gives the current threshold
   for the card.

2. **Show the card.** One card (`ask_user`) with the five levels — `low`, `medium`, `high`,
   `xhigh`, `max` — where each option names the threshold it sets; mark the current one and the
   recommended one from the level policy below. Wait for the answer; apply nothing before it.
   Reason: the threshold decides how every following turn is produced, and `AGENTS.md` §5 makes
   the choice the user's. A silent default would change the behaviour of the model on every
   following turn without anyone having decided it.
   In a child session that cannot address the user directly — the card is put to the user by the
   creator (message to the creator, the answer comes back the same way); a card opened by the
   child blocks the child's turn until the answer arrives.

3. **Pass the blob through the script.** The base of this skill is `scripts/set-effort.js`
   (Node.js, no dependencies, relative to this skill's directory):
   ```
   echo '<blob>' | node scripts/set-effort.js <threshold>
   ```
   Reason: the blob carries the threshold in two places — `model.thinking_effort` (flat) and
   `model.thinking.effort` (nested), plus a top-level `thinking_effort` if there is one. Only the
   flat field governs the behaviour: measured on one child session, `model.thinking_effort =
   "low"` with `model.thinking.effort = "max"` gave a `low`-depth answer (58 ms of reasoning),
   and the same blob with `model.thinking_effort = "max"` gave a `max`-depth answer (19.7 s).
   The nested field is a mirror — writing it alone changes nothing. The script sets all of them
   at once, preserves the other fields and refuses to work if the set of keys has changed.

4. **Write.** `session_update` with `session_id` and the resulting string in `extra_data_json`.
   Reason: only this call changes the threshold of a particular session; there is no global
   threshold setting.

5. **Check the result.** In the answer of `session_update` the field `model.thinking_effort`
   (flat) must match what was requested; the nested `model.thinking.effort` should match as
   well. If the flat field does not — repeat step 4 with the same blob.
   Reason: the server returns the applied configuration, and the flat field is the one that
   decides the depth. Checking the nested mirror proves nothing: it is written by the same call
   and reads back as requested while the depth of the answers stays as it was.

6. **Report to the user** in Russian, addressing the user as «Алон»: which threshold was, which it
   became, that the change takes effect **from the next turn** (the current answer is produced at
   the previous threshold), and that a child session inherits the effective threshold of the
   parent at the moment of the spawn — not the agent's own `agent_data` configuration.
   Reason: without this the user credits the result of the current answer to the new threshold
   and draws a wrong conclusion about the difference between the modes.

## Output contract

- First the card with the five levels; then, after the answer, one message to the user: was → became,
  that it takes effect from the next turn, and on a refusal — the reason and what stayed as it was.
- No files are created. This is an operation on the session configuration, not a document.

## Failure handling

- **`session_update` returned an error about `archived: Expected boolean`** — the boolean field
  flaps on the platform in about half of the attempts. Repeat the same call: it goes through
  without changes. If `archived` is not needed at all in your call — remove it from the payload.
- **The patcher refused to change the set of keys** — do not work around the refusal by hand.
  Show the user which key did not match and go through the blob by eye.
- **`model` in the blob is not an object** — it must not be rewritten blindly; a switch of that
  shape is not supported, report it to the user.
- **The threshold did not change after two attempts** — tell the user which threshold it stayed
  at and offer to check it manually through the interface. Never present an unperformed switch as
  a performed one.
- **The client overrides the session configuration** — in the mobile app (`device_platform:
  "app"`) the client sends its own threshold with every request, so the server-side write lands
  in the blob while the applied depth stays the client's. The signs: `session_update` answers with
  the requested value, the blob keeps it, and the depth of the answers does not change. In that
  case the working path is the switcher in the app's own interface: say that plainly and do not
  claim the switch happened. In the web client the interface has no threshold switcher, and the
  server-side write applies.
- **The server rewrote the blob on write** — it may add an empty `model_resolution: {}` and
  reorder the keys. That is the server's normalisation, not a loss of settings: judge the result
  by the values (`model.thinking_effort` first — it is the effective one) and by the presence of
  the other fields, not by the order of the keys.
- **The card got no answer** — do not apply any level: the threshold stays as it was, and the
  report says that the switch was not performed and why.
- **Three attempts at the same step failed** — stop, report the problem to the user and wait for
  instructions (`AGENTS.md` §4 — after three failed attempts the agent stops and reports).
- **The user asked to measure the difference between thresholds** — that is a measurement task,
  not this one. Here there is only switching.

## Examples

Input: «поставь effort на max»
Output: the blob of the current session is read → the patcher returned it with
`model.thinking_effort = "max"` → `session_update` → the answer shows `thinking_effort: max`.
Report: «было default → стало max, действует со следующего хода».

Input: «переведи сессию 464910352191815 на low»
Output: `session_get` by the named id → the patcher → `session_update` → confirm by the field
`model.thinking_effort` in the answer. The other session fields (`query`, `team_policy`) are
preserved — this is checked by the set of keys of the blob not having changed.
