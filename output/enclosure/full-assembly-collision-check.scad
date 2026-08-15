// Diagnostic only: the result must be empty when the complete enclosure fits
// inside the stand without solid intersections. Intended contact and the
// configured 0.6 mm slot clearance are preserved by the source assembly.
use <codex_widget_enclosure.scad>;

intersection() {
    desktop_stand();
    enclosure_in_stand_transform() {
        union() {
            front_bezel();
            translate([0, 0, 2.6]) rear_tub();
        }
    }
}
