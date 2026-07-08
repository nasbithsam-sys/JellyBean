
# Remove Customize UI + smooth theme transition

## Changes

### 1. Remove Customize UI completely
- `src/components/app-shell.tsx`: delete `ThemeCustomizer` import, the `themeCustomizerOpen` state, the "Customize UI" button (lines ~186–192), the `Paintbrush` icon import, and the `<ThemeCustomizer />` mount at the bottom.
- `src/routes/app.tsx`: delete the `loadSavedTheme` import and its `useEffect` call.
- Delete the files `src/components/theme-customizer.tsx` entirely.
- Leave the dark/light `ThemeToggle` in place (that's a separate feature).

### 2. Smooth, slow light ⇄ dark transition
Interpreting "make it very slow" as a smooth, gradual crossfade (not literally a delay before the new theme takes effect).

- `src/styles.css`: add a global transition on the color/background/border tokens so switching themes fades over ~600ms instead of snapping:
  ```css
  html, body, *, *::before, *::after {
    transition: background-color 600ms ease, color 600ms ease,
                border-color 600ms ease, fill 600ms ease, stroke 600ms ease;
  }
  /* Respect users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    html, body, *, *::before, *::after { transition: none !important; }
  }
  ```
- Keep transitions scoped to color-family properties only (no layout/transform/opacity) so hover/focus micro-interactions and route navigation stay fast.

## Files touched
- `src/components/app-shell.tsx` — remove Customize UI button + mount
- `src/routes/app.tsx` — remove `loadSavedTheme` effect
- `src/components/theme-customizer.tsx` — delete
- `src/styles.css` — add slow theme-color transition

## Non-goals
- No changes to the Dark/Light toggle behavior itself, no changes to any palette values, no other UI edits.

## Verification
- Sidebar no longer shows "Customize UI".
- Toggling dark/light gently crossfades over ~0.6s.
- `tsgo` clean, build passes, no leftover imports of the deleted file.
