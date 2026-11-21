# effort-switch

A Mavis skill for switching the **reasoning threshold** (`thinking_effort`) of a session
between `low`, `medium`, `high`, `xhigh` and `max` — with the user's explicit consent,
shown as a card before anything is applied.

## Why a card first

The threshold decides how every following turn is produced, so the choice belongs to the
user. The skill always shows a card with the five levels (the current one and a
recommended one marked) and applies nothing until the answer arrives — even when the
user has already named a level.

## Install

```bash
git clone https://github.com/alon1989/effort-switch.git ~/.skills/effort-switch
```

The layout is the one the platform expects: `SKILL.md` at the root of the skill directory,
the patcher in `scripts/set-effort.js`.

## How it works

1. `session_get` — read the session blob (`extra_data_json`) and the current threshold.
2. `ask_user` — show the card with the five levels; apply nothing before the answer.
3. `node scripts/set-effort.js <threshold>` — patch the blob. The flat field
   `model.thinking_effort` is the one that governs the depth; the nested
   `model.thinking.effort` is only a mirror.
4. `session_update` — write the patched blob back. The blob is replaced entirely, not merged.
5. Check `model.thinking_effort` in the answer, then report: was → became, effective from
   the next turn.

## Level policy

| Kind of work | Recommended |
| --- | --- |
| mechanical edits, renames, single-step operations | `low` |
| breadth-first ideation | `medium` |
| authoring a skill, drafting a document, review cycles | `high` |
| technical audit of a session or a codebase | `high` |
| system-level planning and design decisions | `xhigh` |
| autonomous implementation end to end | `max` |

## Known platform behaviour

- The **flat** field `model.thinking_effort` decides the depth. Writing only the nested
  `model.thinking.effort` changes nothing.
- The change takes effect **from the next turn**; the current answer is produced at the
  previous threshold.
- A child session inherits the effective threshold of the parent at spawn time, not the
  agent's own `agent_data` configuration.
- In the **mobile app** the client sends its own threshold with every request and
  overrides the server-side write — use the switcher in the app's own interface there.
  In the web client the server-side write applies.
- The server may normalise the blob on write (an empty `model_resolution: {}`, reordered
  keys). Judge the result by the values and by the presence of the other fields, not by
  the key order.
- The patcher refuses to work if the set of keys in the blob has changed, and refuses a
  `model` that is not an object. Both refusals are deliberate.

## Requirements

Node.js (no dependencies) and the platform's `session_get` / `session_update` / `ask_user`
tools.
