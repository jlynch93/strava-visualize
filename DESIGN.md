---
name: Run Trends
description: A precise running ledger on mineral paper, with deep ink and a restrained lime action signal.
colors:
  paper: "oklch(96.8% 0.012 135)"
  paper-deep: "oklch(93.5% 0.018 136)"
  surface: "oklch(99% 0.008 135)"
  surface-muted: "oklch(95.2% 0.015 137)"
  ink: "oklch(20% 0.035 226)"
  ink-strong: "oklch(14% 0.038 226)"
  ink-soft: "oklch(39% 0.03 226)"
  ink-faint: "oklch(43% 0.024 226)"
  rule: "oklch(79% 0.018 150)"
  rule-strong: "oklch(60% 0.026 184)"
  accent: "oklch(88% 0.21 116)"
  accent-hover: "oklch(82% 0.2 116)"
  accent-ink: "oklch(17% 0.04 140)"
  teal: "oklch(52% 0.105 190)"
  teal-soft: "oklch(91% 0.04 190)"
  blue: "oklch(52% 0.12 258)"
  blue-soft: "oklch(93% 0.035 258)"
  orange: "oklch(62% 0.18 42)"
  orange-soft: "oklch(93% 0.045 42)"
  red: "oklch(57% 0.18 26)"
  red-soft: "oklch(93% 0.04 26)"
  green: "oklch(50% 0.14 153)"
typography:
  display:
    fontFamily: 'Aptos, "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: "2.7rem"
    fontWeight: 760
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontSize: "2rem"
    fontWeight: 760
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontSize: "1.2rem"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Aptos, "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1rem"
    lineHeight: 1.5
  label:
    fontSize: "0.7rem"
    fontWeight: 760
    letterSpacing: "0.025em"
rounded:
  flat: "0"
  compact-control: "5px"
  field: "6px"
  action: "7px"
  circle: "50%"
spacing:
  tight: "6px"
  small: "10px"
  control: "12px"
  mobile-panel: "16px"
  section: "20px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.action}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.action}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.action}"
    padding: "8px 9px"
  button-save:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.compact-control}"
    padding: "0 13px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.field}"
    padding: "0 10px"
    height: "40px"
  navigation-link:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.compact-control}"
    padding: "10px 12px"
  source-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.flat}"
    padding: "5px 8px"
  key-run:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.flat}"
    padding: "17px 20px"
---

# Design System: Run Trends

## Overview

**Creative North Star: "The Performance Ledger"**

Mineral paper, deep blue-black ink, fine rules, and electric lime give this running dashboard the feel of a precise working record. The interface supports understanding a training block, planning upcoming runs, and exploring history with the same quiet visual language.

This document describes the rendered implementation. `public/styles.css` supplies the base system; `public/dashboard.css` loads afterward and refines the dashboard cascade. `public/index.html` uses native controls and disclosures, while `public/script.js` renders data and SVG charts with vanilla JavaScript. The refinement adds no runtime dependency. Component examples and schema extensions live in `.impeccable/design.json`.

**Key Characteristics:**

- Flat paper surfaces, fine dividers, and compact sans-serif typography.
- Lime identifies prominent actions; teal carries the primary training data.
- A concise overview leads into inspectable periods, run details, and planning.
- Density adapts through reflow, disclosures, and a paginated ledger.

## Colors

### Primary

Electric lime (`accent`) marks connection and prominent plan actions, the thin page-top rule, and selected identity details. Pair it with `accent-ink`; use `accent-hover` for the primary button's hover state.

### Secondary

Training teal (`teal`) marks the main trend bars, key-run labels, data-source indicator, and context-save controls. Its pale companion supports gentle emphasis. Blue provides keyboard focus and secondary data encoding; orange, red, and green communicate differentiated training signals and status alongside text.

### Neutral

Mineral paper (`paper`) is the page canvas. `surface` lifts content through tone; `paper-deep` and `surface-muted` support selected or hovered regions. Deep ink distinguishes headings, body text, and secondary explanations. The effective `ink-faint` value comes from the dashboard override. `rule` and `rule-strong` establish structure without card shadows.

## Typography

Use the local Aptos / Segoe UI system stack for headings, prose, controls, and SVG labels. There is no separate display or monospace font and no remote font dependency.

The display role belongs to onboarding; the smaller headline belongs to the loaded overview. Section titles stay compact, while metric figures gain hierarchy from size, weight, and tabular numerals. Most dashboard explanations sit below the base body size, around 0.8–0.88rem. Form labels use sentence case; uppercase tracking is reserved for the wordmark, table headings, and short categorical labels. On mobile the overview headline becomes 1.65rem and onboarding becomes 2.1rem.

## Layout

The centered application caps at 1320px, with 28px minimum side gutters on larger screens and 16px gutters at 700px and below. Regular panel spacing falls between 16px and 24px. The overview joins its three-part evidence strip to the primary chart as one continuous bordered surface. The chart is 270px high on desktop and 230px on mobile.

The dashboard layer reflows at 1100px and 700px. At the intermediate width, navigation receives its own header row and planning uses fewer columns. At mobile width, actions wrap, chart controls sit below their heading, key runs and coaching become single columns, and recommended days become compact rows. The ledger changes from a table to run-name/date/distance/pace rows; the detail action preserves access to the remaining run information. Base stylesheet breakpoints at 1160px, 820px, and 560px still affect supporting charts and workout details; inspect both stylesheets when extending responsive behavior.

## Elevation & Depth

Resting panels are flat, separated by light surfaces, borders, and whitespace. The dark plan region is a tonal change, with lime actions and light text. Floating tooltips and the workout dialog carry the actual depth: the tooltip uses a compact shadow, and the dialog uses `shadow-sheet` over a dimmed, blurred backdrop. Keep those shadows on overlays. Their exact values, the shared easing curve, and breakpoint metadata are in the sidecar.

## Shapes

Content panels, key-run cards, plan days, and source chips have square corners. Controls soften slightly: navigation and context controls use the compact radius; fields and general actions use their respective radii. Circular controls are limited to compact detail and close actions. Fine borders and occasional colored top rules are the recurring form language.

## Components

- **Buttons:** Primary actions use lime; secondary actions use a light surface and border; ghost actions rely on text. Context saves use teal, while the plan's main action returns to lime. Standard controls have a 40px minimum height, with compact source/detail controls retaining their own sizing. General button hover moves upward by 1px, active returns to rest, and disabled buttons reduce opacity. Keyboard focus uses a blue outline; fields additionally use a pale blue halo.
- **Fields and navigation:** Keep visible labels with native search inputs, date inputs, and selects. Section navigation uses text links with a paper-deep selected/hover surface; the active section is reflected through `aria-current`.
- **Overview and charts:** Preserve the evidence strip and trend as a connected unit. Teal bars darken on interaction; empty periods remain visible. Metric and grouping selects belong beside the chart heading, and selectable periods open the relevant runs. Chart interactions support keyboard activation and descriptive labels.
- **Key runs and source chips:** Flat, outlined cards use a teal category label, strong run name, and quieter supporting metrics. Source chips are small square buttons that open the cited run context.
- **Disclosures and plan:** Goal and check-in inputs sit inside native disclosures, as do supporting analytics. Recommended days sit in a dark calendar region and cycle between planned, completed, and skipped while retaining keyboard focus. Context-save hover uses ink with light text; the plan copy action uses the darker lime hover token. Keep summary labels meaningful while the content is closed.
- **Run ledger:** Search by run name, four sort choices, 15 runs per page, explicit previous/next buttons, result counts, and a recoverable empty-search message. CSV export and a shareable view link remain adjacent to the controls. Long run names wrap. Mobile rows retain distance and pace labels without requiring horizontal table scrolling.
- **Workout details and empty states:** Details open in a labeled modal with close and keyboard behavior. No-history onboarding exposes connection, import, and demo entry points; an empty selected date window offers a recovery action. Status messages stay near the current review controls.

## Do's and Don'ts

### Do:

- **Do** read the base stylesheet and dashboard override together before extending the system.
- **Do** keep data labels, units, visible focus, and empty states attached to the relevant controls.
- **Do** use reflow and disclosures to retain readable run details on narrow screens.
- **Do** preserve the paper, ink, lime, and teal hierarchy across new surfaces.

### Don't:

- **Don't** add decorative shadows to resting data panels.
- **Don't** replace native controls with custom widgets without a concrete interaction need.
- **Don't** rely on color alone to explain a training signal or clickable chart period.
- **Don't** turn the mobile ledger back into a wide, horizontally scrolling desktop table.
