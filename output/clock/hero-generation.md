# HH:MM:SS product render

Generated with the built-in `image_gen` tool on 2026-09-06.

- Output: [codex-widget-graffiti-clock-v2.png](../enclosure/codex-widget-graffiti-clock-v2.png)
- Enclosure reference: [previous product render](../enclosure/codex-widget-graffiti-clock-v1.png)
- Screen reference: [firmware drawing frames](flip-clock-frames.png), leftmost frame only
- Motion preview: [flip-clock-preview.gif](flip-clock-preview.gif)

The product render is an AI-generated concept image. The GIF and frame strip use the firmware's drawing and flip projection code with a host bitmap adapter; text and primitive rasterization can differ from the TFT library. These assets are not photographs or screen recordings of the device.

## Final prompt

```text
Use case: precise-object-edit / product-mockup.
Asset type: GitHub README hero product concept render, landscape 1536x1024.
Input 1 is the edit target: existing black Codex desktop widget on its tilted black stand on a warm wooden workbench. Preserve its enclosure, recessed square LCD, engraved CODEX word, stand, viewpoint, workshop background, realistic materials and lighting.
Input 2 is the authoritative updated screen-layout reference: a horizontal strip of FIVE ANIMATION FRAMES. Use ONLY the LEFTMOST square frame as the static screen content, NOT the whole strip. It reads 12:59:59.
Primary request: regenerate the product render with the current firmware's HH:MM:SS display accurately replacing the old FOUR single-digit cards. The screen must have EXACTLY THREE adjacent tall flip cards; EACH card contains TWO digits. The three cards read "12", "59", "59", with thin colon dots BETWEEN cards. Above the cards, small plain white uppercase labels exactly "HOUR", "MIN", "SEC". Pink digits on the first card, lime-green digits on the middle card, pink digits on the last card. Digits are narrow straight segmented numerals with pale outlines, a few paint chips and drips, matching reference 2 closely; do not use the old rounded poster lettering from image 1.
Each paired card is divided into upper and lower halves by a crisp horizontal black hinge at its midpoint, with small silver pivot dots at its sides, subtle page thickness and natural shadow. This is a flat LCD showing an animated mechanical-flip metaphor, not a physical split-flap mechanism projecting out of the device.
At bottom of display show one clean readable status line exactly: left "IDLE", center "24.6C 48%", right a small green dot and "LIVE". Maintain spacious layout matching the LEFTMOST square of reference 2. Fit the entire new interface inside the EXISTING display aperture with realistic perspective, including all six digits and all labels. No additional text outside the device. No extra devices, arrows, captions, badges, watermark, borders, or diagram panels. Finished polished photorealistic concept render suitable for project documentation.
```
