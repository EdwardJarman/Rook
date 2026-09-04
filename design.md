# Rook — Mobile Interface Design

## Design intent

Rook is a calm, Bot-first AI workroom for managing specialized Bots. The design targets a 9:16 mobile portrait canvas and one-handed use, following standard iOS conventions for safe areas, readable hierarchy, large touch targets, sheets for secondary actions, and clear system feedback. The app should feel like a refined conversation product rather than an automation dashboard.

## Brand and color choices

The Rook identity pairs a warm paper canvas with deep ink surfaces and a single green accent. Primary actions, user messages, and active controls are monochrome ink — the accent is reserved for interactive emphasis, success, and focus. Bot identities render as soft tinted washes rather than saturated fills, keeping the roster colorful but quiet.

The light palette is built around **Canvas #F7F7F4**, **Surface #FFFFFF**, **Text #191C22**, **Muted #565E6B**, **Line #E9E8E2**, **Ink #1A1D23**, and **Accent #0E7C59**. The dark palette is a true ink mode: **Canvas #0A0C10**, **Surface #141820**, **Text #F1F3F6**, **Muted #A6AFBC**, **Line #262C38**, **Ink #ECEFF3** (light primaries on dark), and **Accent #6FE8BC**. Semantic tones — mint, amber, coral — always pair a readable foreground with a soft tinted background and are identical concepts in both schemes.

Design tokens are resolved at runtime through `useRookTheme()` in `lib/ui.ts`, so every surface, including native, follows the user's light or dark preference. Shared primitives in `components/rook-primitives.tsx` (Avatar, buttons, StatusPill, Card, Sheet, Switch, SegmentedControl, Field, EmptyState) consume those tokens so screens stay consistent and theme-correct by construction.

## Screen list

| Screen | Primary content and functionality |
| --- | --- |
| Welcome | Original value proposition, privacy/capability disclosure, and entry into the demo workroom. |
| Workroom | Conversation-first home with Bot switcher, timeline, task activity, result cards, and composer. |
| Bots | Searchable Bot roster, role cards, status summaries, creation, editing, duplication, pause, archive, and deletion controls. |
| Bot profile | Role, instructions, memory summary, enabled skills, routines, permissions, files, and activity. |
| Task detail | Plan, live step/status trail, interruption controls, result summary, evidence, and pending decisions. |
| Group workroom | Shared objective, active owner, Bot handoffs, task timeline, threaded replies, and reassign/stop actions. |
| Skills | Reusable processes with inputs, decision rules, output, validation, approval boundaries, version, test, and enablement status. |
| Routines | Schedule or event description, owner, time zone, next run, approval rules, pause/resume, run-now, and history. |
| Approvals | Pending, approved, rejected, expired, and cancelled decisions with risk context and audited actions. |
| Files | Project folders, Bot-private/shared labels, file search, previews, downloads, and message attachment links. |
| Notifications | Completion, blockers, approvals, routines, and handoff updates that deep-link to their context. |
| Search | Global search across Bots, messages, files, skills, routines, links, approvals, and settings. |
| Account | First-class profile and session area for storage status, export, data deletion, and a clearly labeled Sign out control. |

## Key user flows

### Create a Bot and complete a task

The user opens the Bot switcher, taps **New Bot**, selects a role template or starts from scratch, provides a name and goal, and confirms approval boundaries. The user then sends a natural-language task. Rook displays a short plan, starts the task, shows visible activity, and returns a result card with evidence, a generated artifact where applicable, and next steps.

### Review and approve a sensitive action

When a task reaches a higher-risk step, the conversation displays an approval card with the proposed action, rationale, impact, and alternatives. The user can approve, decline, or edit the instruction. The decision is appended to the task timeline and is accessible in Approvals.

### Save a process and automate it

From a completed task, the user chooses **Save as skill**, reviews the draft instructions, adds boundaries and validation, and tests the skill. From the skill detail, the user chooses **Create routine**, reviews timing, owner, inputs, risk rules, and next run, then activates or keeps it paused.

### Collaborate across Bots

The user starts a group workroom, selects a lead and specialists, describes the outcome, and assigns the first owner. Handoffs appear in a compact timeline. The user can intervene from any message to redirect, reassign, pause, or stop.

## Layout rules

The Workroom screen uses a fixed, safe-area-aware top bar with the current Bot and connection state. The conversation occupies the middle scroll region as a clean chat canvas: Bot replies render as plain text rows beside a small avatar, user messages as ink bubbles, and system events as quiet centered notes. The composer is a calm capsule above the home indicator, with a clear attach action and a primary send action that signals when it is armed. Bot switching, task details, skill references, and profile settings open in sheets or full-screen modals so the conversation remains the primary surface.

The navigation includes **Work**, **Bots**, **Library**, **Updates**, and **Account** rendered in a frosted floating dock that hides on scroll-down and returns on scroll-up. Library is explicitly named rather than implied as "Space"; Account is a direct destination rather than a hidden Library sub-section. Files, routines, skills, search, and privacy remain organized inside Library behind a segmented control; decisions and recent work live in Updates. On wide web canvases (960px and up), the dock yields to a quiet left sidebar — a rounded white panel floating on the canvas with the workspace mark, line-icon destinations, and a compact account footer — while each screen moves onto an inset stage beside it. The same named destinations remain visible on every width without changing the information architecture; phones and tablets keep the floating dock exactly as it is.

## Accessibility requirements

All controls use semantic labels, accessible status text, strong contrast, minimum 44pt touch targets, and visible focus states. Motion is restrained and respects user preference. Important task changes are expressed with both color and words. Every action must be reachable without relying on hover or precision input.
