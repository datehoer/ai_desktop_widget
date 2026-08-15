# Design QA — Combined 3D Manipulator

## Target

- Reference static state: `/var/folders/jh/pjjtryy945q7q_1xvnmvht500000gn/T/codex-clipboard-ca2cef84-b3d6-4a42-ac67-5887cbf78353.png`
- Reference rotation state: `/var/folders/jh/pjjtryy945q7q_1xvnmvht500000gn/T/codex-clipboard-fbc0f48c-85e6-4662-8c49-2512e25dec4e.png`
- Implementation static state: `.playwright-cli/page-2026-08-15T08-27-40-402Z.png`
- Implementation rotation state: `.playwright-cli/page-2026-08-15T08-28-01-030Z.png`
- Side-by-side comparison: `.playwright-cli/design-comparison.png`
- Desktop viewport: `1440 × 980`; implementation viewport crop: `1140 × 770` at `(300, 120)`.
- Mobile viewport: `390 × 844`; 3D viewport: `390 × 648`.

## Visual comparison

- Static selection state matches the reference interaction hierarchy: cyan selected outline, eight square scale handles, a dashed vertical lift control, and external rotation affordances shown at the same time.
- Active rotation state matches the reference's two-zone dial: a 16-segment fixed inner ring and a separate outer fine-control band.
- The live angle readout is positioned at the active pointer and reproduced the reference value `-4°`; the implementation adds the useful precision label `精细 1°`.
- Axis-specific rotation handles are color-coded and labeled X/Y/Z so all three rotation planes are discoverable without switching tools.
- The implementation keeps Print Lab's existing orange/cyan product palette instead of copying Tinkercad's purple model material.
- Handles clamp to the visible viewport edge when the projected model bounds exceed the camera crop. At `390 × 844`, every scale, rotation, and lift handle remained inside the interactive viewport with no horizontal document overflow.

## Functional checks

- Direct model-body drag changed X/Y position from `0.0, 0.0` to `2.8, -8.4`.
- East scale handle changed X scale from `1.00` to `1.26` and showed `X 1.26×`.
- Lift handle changed Z from `0.0` to `10.0 mm`.
- Inner rotation ring produced `90.0°`, an exact `22.5°` increment, with `固定 22.5°` feedback.
- Outer rotation ring produced `112°` and `-4°` with `精细 1°` feedback.
- Browser console: 0 errors, 0 warnings. Failed application requests: 0.
- X/Y rotation performance pass: pointer updates are coalesced to animation frames, the rotation dial remains fixed during drag, inspector/stat recomputation is deferred until pointer-up, and Retina rendering temporarily drops to 1× only while dragging before restoring full resolution.
- X and Y regression drag each completed at `90.0°` with matching live readouts and a stable dial center.
- Generic physics pass: Rapier loads only when requested; selected-only and all-part free fall use dynamic convex-hull colliders, static triangle-mesh colliders, a fixed print-bed collider, CCD, friction, restitution, pause/resume, collision counting, and position restore.
- Two-part all-body regression produced `碰撞 2`; manual transforms were locked during simulation, the gizmo was hidden, and reset restored the editing state.
- Manual collision regression with `front-black-v5-wide.stl` and `back-smoke-petg-v6-wide.stl`: moving the second part from X `62.0` toward X `0.0` stopped at the last safe pose, X `50.4`, instead of overlapping. The same path guard is used by direct body drag, lift, rotation, centering, bed placement, numeric position, and numeric rotation.
- Near-contact performance regression: an isolated 80-event pointer-handler run held against the other part completed in `199.3 ms` total (`2.49 ms/event` average); the steady-state SAT checks were normally `0–0.2 ms`. Live editing now uses Three.js's existing 3D OBB/SAT implementation with cached local OBBs. Rapier is lazy-loaded only for free-fall and low-frequency large transforms that need native collider casting/CCD.
- Contact-release regression with two generic `40 × 40 × 20 mm` boxes: the moving box stopped at the separating boundary, then moved away and returned to the cyan selection outline during the same uninterrupted pointer gesture. The 15-point collide-and-reverse browser drag completed in `35 ms`; no deselection or second click was required.
- Pointer-follow regression with two generic `40 × 40 × 20 mm` parts: one sparse two-point drag moved the selected part directly from `X 52.0, Y 0.0` to `X 138.8, Y 15.6` in `49 ms`, rather than advancing only the former `2.5 mm` per-event cap. A separate two-point drag aimed through the other part still stopped at the separating boundary (`X 9.7, Y -2.3` versus the obstacle at `X 52.0, Y 0.0`) in `27 ms`.
- Post-contact continuity regression: one uninterrupted drag moved into the other generic part and then reversed through 24 consecutive `5 px` pointer increments. Every reverse increment stayed in contact-relative mode, the part finished separated at `X 59.3, Y -14.2`, the outline was cyan, and the full path completed in `60 ms` without reselecting or releasing the pointer.
- All-body thin-platform regression: a generic `100 × 100 × 2 mm` dynamic plate and two centered dynamic boxes (`20 mm` and `16 mm` tall) were spawned in non-overlapping vertical intervals. After settling, their root Z positions were exactly `0.0`, `2.0`, and `22.0 mm`, proving both boxes rested on the preceding collider instead of tunnelling through the plate. Rapier reported 5 contacts; browser console had 0 errors and 0 warnings.
- Selection flicker regression: both a parts-list switch and a direct canvas click changed the selected part while the WebGL canvas PNG remained byte-for-byte identical (`27,718` data-URL characters before and after). Selection now updates only the 2D overlay and DOM inspector; an un-dragged click does not change renderer pixel ratio or call WebGL render.
- `npm run viewer:build`: passed.
- `npm test`: 5 passed, 0 failed.

## Iteration history

1. Replaced three mutually exclusive move/rotate/scale modes and Three.js TransformControls with one persistent combined manipulator.
2. Added viewport projection, handle hit-testing, pointer capture, real-time numeric feedback, fixed/fine rotation modes, direct model drag preservation, and mobile-safe handle clamping.
3. Compared both reference states and both implementation states in one composite image, then verified the reference's key visual and behavioral traits were present.
4. Removed idle geometry recomputation and the per-pointer X/Y bounding-box/statistics work after hands-on feedback about rotation stutter.
5. Added lazy-loaded generic rigid-body physics and replaced destructive selection rerenders with in-place list updates.
6. Added default-on edit collision protection, removed the WebGL selection helper, and delayed drag-quality switching until the pointer crosses the movement threshold.
7. Replaced per-pointer physics stepping with the existing Three.js OBB/SAT narrow phase, cached local OBBs at import time, moved collision feedback onto the gizmo canvas, and kept Rapier's native collider cast/CCD for large one-shot transforms and rigid-body simulation.
8. Fixed contact release by comparing adjacent pointer targets instead of the stale absolute target: inward input is rejected, tangent input slides along the contact, and outward input immediately resumes from the last accepted pose.
9. Removed the `2.5 mm` accepted-movement cap that made fast drags lag behind the pointer. Live edits now subdivide the full requested path for cached OBB/SAT checks and accept the complete pointer pose whenever every sample is clear.
10. Kept pointer movement in incremental contact-relative mode for the remainder of a drag after its first collision. This prevents the next frame from jumping back to the stale, penetrating absolute target and eliminates alternating red-frame stalls while dragging away.
11. Made free-fall initialization collision-safe: dynamic bodies now start in disjoint vertical intervals, Rapier runs four hard-CCD substeps plus soft CCD and extra solver iterations, and degenerate per-mesh convex hulls receive a conservative thin-box fallback instead of leaving holes in compound parts.

final result: passed
