# Engineering Workflow — SoundDrop v5.0

1. **Strict Zero-Mock Audit**: Never introduce synthetic arrays, fake peer nodes, or random hashes.
2. **Accessibility First (WCAG AA)**:
   - Minimum `4.5:1` contrast ratio for body text (`text-slate-300` / `text-slate-100` on `bg-slate-950`).
   - Full keyboard navigation, `:focus-visible` outlines, semantic ARIA `tablist` / `tabpanel` roles, and pinch-to-zoom enabled (`maximumScale: 5`).
3. **Verification Gate**:
   - `npm run lint` & `npm run build` must succeed with zero errors.
   - Live browser verification of Empty State, Directory Picker + `webkitdirectory` fallback, API routes, and 9 protocol tabs.
