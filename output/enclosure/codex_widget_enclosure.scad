// Codex Usage Widget — Option 3 printable enclosure
// Black front bezel + smoke PETG rear tub + removable 15-degree stand
// Units: millimetres
// Set part to: "assembly", "front", "back", or "stand".

$fn = 64;
selected_part = is_undef(part) ? "assembly" : part;

// ---------- Measured TFT module ----------
tft_pcb_w = 32;
tft_pcb_h = 44;
tft_pcb_t = 1.6;
tft_hole_d = 2;
tft_hole_edge_gap = 1;               // interpreted as hole edge -> PCB edge
tft_hole_center_inset = tft_hole_edge_gap + tft_hole_d / 2;
tft_hole_pitch_x = tft_pcb_w - 2 * tft_hole_center_inset; // 28
tft_hole_pitch_y = tft_pcb_h - 2 * tft_hole_center_inset; // 40

screen_w = 32;
screen_h = 33;
screen_black_border = 1;
screen_bezel_overlap = 0.8;
screen_window_w = screen_w - 2 * screen_bezel_overlap; // 30.4
screen_window_h = screen_h - 2 * screen_bezel_overlap; // 31.4
screen_end_margin_measured = 5.4;
tft_total_t = 4;
screen_above_pcb = tft_total_t - tft_pcb_t; // 2.4

// Module placement on the tall front face.
tft_pcb_center_y = 7;
screen_center_offset_y = 0;
screen_window_y = tft_pcb_center_y + screen_center_offset_y;

// ---------- Measured ESP32 and cable bundle ----------
esp_w = 20.5;
esp_h = 52;
esp_t = 1.6;
esp_side_clearance = 0.6;
dupont_wire_length = 80;
connected_stack_depth = 23;
wire_bend_allowance = 7;

usb_connector_w = 9;
usb_connector_protrusion = 2;
usb_cutout_clearance = 0.4;
usb_cutout_w = usb_connector_w + 2 * usb_cutout_clearance; // 9.8
usb_cutout_h = 5.2;

// ---------- Enclosure ----------
case_w = 50;
case_h = 78;
rear_usb_center_y = -case_h/2 + 10; // rear-panel port, 10 mm above case bottom
corner_r = 4;
wall = 2.4;
front_plate_t = 2.6;
back_plate_t = 2.2;
internal_depth = connected_stack_depth + wire_bend_allowance; // 30
rear_tub_depth = internal_depth + back_plate_t;               // 32.2
assembled_external_depth = front_plate_t + rear_tub_depth;    // 34.8

fit_clearance = 1;
lip_h = 3;
lip_wall = 1.4;                       // safely above the printer's >1.2 mm rule
lip_tip_inset = 0.5;                  // tapered lead-in for self-alignment

// TFT mounts from the rear into blind front bosses.
tft_standoff_h = screen_above_pcb; // 2.4
tft_boss_od = 5.5;
tft_pilot_d = 1.7;
tft_pilot_depth = 1.8;

// Four M2 rear screws pass through hollow rear guides and enter short bosses
// on the front bezel.  This avoids four long front posts jamming during close.
case_screw_d = 2.25;
case_pilot_d = 1.7;
case_boss_od = 5;
case_boss_tip_d = 4.2;
case_screw_x = 10;
case_screw_y = 29;
front_case_boss_straight_h = 5;
front_case_boss_tip_h = 1;
front_case_boss_h = front_case_boss_straight_h + front_case_boss_tip_h;
rear_funnel_outer_d = 7.4;
rear_funnel_mouth_d = 5.6;
rear_funnel_throat_d = 4.6;
rear_funnel_depth = 1.2;
rear_funnel_taper_h = 1.5;
case_pilot_depth = 4;

// ESP tray on the inside of the translucent rear panel.
esp_center_y = -7;
esp_rail_w = 2;
esp_rail_projection = 3.6;
esp_rail_clearance = 0.5;
esp_bottom_stop_h = 2;
cable_guide_d = 3.5;
cable_guide_projection = 3.2;

// Stand: a true 15-degree docking cradle, not just a decorative wedge.
stand_angle = 15;
stand_w = case_w + 10;
stand_depth = 60;
stand_base_t = 3;
stand_back_h = 32;
stand_front_lip_h = 11;
stand_support_t = 3.2;
stand_side_h = 16;
stand_side_t = 3;
stand_slot_clearance = 0.6;
stand_cable_channel_w = 14;


module rounded_rect_2d(w, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r], y = [-h/2+r, h/2-r])
            translate([x, y]) circle(r=r);
    }
}

module rounded_box(w, h, d, r) {
    linear_extrude(height=d) rounded_rect_2d(w, h, r);
}

module rounded_slot_2d(length, width) {
    hull() {
        translate([-length/2 + width/2, 0]) circle(d=width);
        translate([ length/2 - width/2, 0]) circle(d=width);
    }
}

function yz_add(a, b) = [a[0] + b[0], a[1] + b[1]];
function yz_scale(a, s) = [a[0] * s, a[1] * s];

// Extrude a polygon described in desktop-stand Y/Z coordinates along X.
module yz_extrude(points, width, x_center=0) {
    translate([x_center, 0, 0])
        rotate([0, 90, 0])
            linear_extrude(height=width, center=true, convexity=10)
                polygon(points=[for (p = points) [-p[1], p[0]]]);
}

module tft_hole_positions() {
    for (x = [-tft_hole_pitch_x/2, tft_hole_pitch_x/2],
         y = [-tft_hole_pitch_y/2, tft_hole_pitch_y/2])
        translate([x, y + tft_pcb_center_y, 0]) children();
}

module case_screw_positions() {
    for (x = [-case_screw_x, case_screw_x],
         y = [-case_screw_y, case_screw_y])
        translate([x, y, 0]) children();
}

module front_alignment_lip() {
    lip_outer_w = case_w - 2*wall - 2*fit_clearance;
    lip_outer_h = case_h - 2*wall - 2*fit_clearance;
    lip_tip_w = lip_outer_w - 2*lip_tip_inset;
    lip_tip_h = lip_outer_h - 2*lip_tip_inset;
    lip_inner_w = lip_outer_w - 2*lip_wall;
    lip_inner_h = lip_outer_h - 2*lip_wall;
    lip_inner_tip_w = lip_tip_w - 2*lip_wall;
    lip_inner_tip_h = lip_tip_h - 2*lip_wall;
    difference() {
        linear_extrude(height=lip_h,
                       scale=[lip_tip_w/lip_outer_w,
                              lip_tip_h/lip_outer_h])
            rounded_rect_2d(lip_outer_w,
                            lip_outer_h,
                            max(1, corner_r-wall));
        translate([0, 0, -0.1])
            linear_extrude(height=lip_h+0.2,
                           scale=[lip_inner_tip_w/lip_inner_w,
                                  lip_inner_tip_h/lip_inner_h])
                rounded_rect_2d(lip_inner_w,
                                lip_inner_h,
                                max(0.8, corner_r-wall-lip_wall));
    }
}

module front_bezel() {
    difference() {
        union() {
            // Visible matte-black face.
            rounded_box(case_w, case_h, front_plate_t, corner_r);

            // Shallow registration lip inside the smoke rear tub.
            translate([0, 0, front_plate_t]) front_alignment_lip();

            // TFT bosses support the PCB front surface 2.4 mm behind the screen face.
            tft_hole_positions()
                translate([0, 0, front_plate_t])
                    cylinder(d=tft_boss_od, h=tft_standoff_h);

            // Short, tapered bosses cannot bind against the rear-shell walls.
            case_screw_positions()
                translate([0, 0, front_plate_t])
                    union() {
                        cylinder(d=case_boss_od,
                                 h=front_case_boss_straight_h);
                        translate([0, 0, front_case_boss_straight_h])
                            cylinder(d1=case_boss_od,
                                     d2=case_boss_tip_d,
                                     h=front_case_boss_tip_h);
                    }
        }

        // Screen window; leaves about 0.2 mm of the 1 mm black border visible.
        translate([-screen_window_w/2,
                   -screen_window_h/2 + screen_window_y,
                   -0.5])
            cube([screen_window_w, screen_window_h, front_plate_t + 1]);

        // Blind TFT pilot holes, open only from the rear of each boss.
        tft_hole_positions()
            translate([0, 0,
                       front_plate_t + tft_standoff_h - tft_pilot_depth])
                cylinder(d=tft_pilot_d, h=tft_pilot_depth + 0.5);

        // Blind case-post pilot holes for M2 screws entering from the rear.
        case_screw_positions()
            translate([0, 0,
                       front_plate_t + front_case_boss_h - case_pilot_depth])
                cylinder(d=case_pilot_d, h=case_pilot_depth + 0.5);
    }
}

module vent_slots() {
    for (y = [14, 19, 24])
        translate([0, y, internal_depth - 0.5])
            linear_extrude(height=back_plate_t + 1)
                rounded_slot_2d(18, 2.2);
}

module esp_tray_and_guides() {
    // Rear interior face is z=internal_depth. Rails project forward (toward z=0).
    rail_z = internal_depth - esp_rail_projection;
    rail_y0 = esp_center_y - esp_h/2;

    // Two side guides; deliberately loose for FDM tolerance.
    for (x = [-esp_w/2 - esp_side_clearance - esp_rail_w,
               esp_w/2 + esp_side_clearance])
        translate([x, rail_y0, rail_z])
            cube([esp_rail_w, esp_h, esp_rail_projection]);

    // Bottom stop leaves the USB-C connector centred in the bottom opening.
    translate([-esp_w/2-esp_side_clearance,
               rail_y0-esp_bottom_stop_h,
               rail_z])
        cube([esp_w+2*esp_side_clearance,
              esp_bottom_stop_h,
              esp_rail_projection]);

    // Simple cable guide posts define two relaxed U-shaped routes beside the board.
    for (x = [-16, 16], y = [-13, 8])
        translate([x, y, internal_depth-cable_guide_projection])
            cylinder(d=cable_guide_d, h=cable_guide_projection);
}

module rear_case_screw_guides() {
    // The front boss's 1 mm tapered tip enters this wide funnel.  The outer
    // flare is kept thick enough for FDM, then tapers to the 5 mm guide tube.
    guide_front_z = front_case_boss_straight_h;
    guide_h = internal_depth - guide_front_z;
    case_screw_positions()
        translate([0, 0, guide_front_z])
            union() {
                cylinder(d=rear_funnel_outer_d,
                         h=rear_funnel_depth);
                translate([0, 0, rear_funnel_depth])
                    cylinder(d1=rear_funnel_outer_d,
                             d2=case_boss_od,
                             h=rear_funnel_taper_h);
                translate([0, 0,
                           rear_funnel_depth+rear_funnel_taper_h])
                    cylinder(d=case_boss_od,
                             h=guide_h-rear_funnel_depth-rear_funnel_taper_h);
            }
}

module rear_tub() {
    difference() {
        union() {
            // Smoke-PETG tub: open at the front, solid rear panel.
            difference() {
                rounded_box(case_w, case_h, rear_tub_depth, corner_r);
                translate([0, 0, -0.5])
                    rounded_box(case_w-2*wall,
                                case_h-2*wall,
                                internal_depth+0.5,
                                max(1, corner_r-wall));
            }

            esp_tray_and_guides();
            rear_case_screw_guides();
        }

        // Funnel-shaped lead-in receives the short tapered front boss; the
        // M2 clearance bore continues through the rest of the guide tube.
        guide_front_z = front_case_boss_straight_h;
        case_screw_positions()
            union() {
                translate([0, 0, guide_front_z-0.1])
                    cylinder(d1=rear_funnel_mouth_d,
                             d2=rear_funnel_throat_d,
                             h=rear_funnel_depth+0.2);
                translate([0, 0,
                           guide_front_z+rear_funnel_depth-0.1])
                    cylinder(d=case_screw_d,
                             h=rear_tub_depth-guide_front_z-
                               rear_funnel_depth+0.7);
            }

        // Rear-facing USB-C opening.  This is intended for a short internal
        // extension from the ESP32's onboard connector to the rear panel.
        translate([-usb_cutout_w/2,
                   rear_usb_center_y-usb_cutout_h/2,
                   internal_depth-0.5])
            cube([usb_cutout_w,
                  usb_cutout_h,
                  back_plate_t+1]);

        // Rear ventilation slots above the ESP32.
        vent_slots();

        // Optional RST/BOOT access holes in the rear panel.
        for (x = [-5, 5])
            translate([x, -1, internal_depth-0.5])
                cylinder(d=3, h=back_plate_t+1);
    }
}

module desktop_stand() {
    slot_d = assembled_external_depth + 2*stand_slot_clearance;
    slot_w = case_w + 2*stand_slot_clearance;
    s = sin(stand_angle);
    c = cos(stand_angle);

    // The case rotates backward around the centre of its lower edge.  This
    // raises the front-bottom corner and leaves the rear-bottom corner on the
    // base.  The saddle follows that real tilted bottom face.
    pivot_z = stand_base_t + slot_d/2*s;
    p_front = [-slot_d/2*c, pivot_z + slot_d/2*s];
    p_rear  = [ slot_d/2*c, pivot_z - slot_d/2*s];
    up = [s, c];
    rear_out = [c, -s];
    front_out = [-c, s];
    bottom_out = [-s, -c];

    rear_plate = [
        p_rear,
        yz_add(p_rear, yz_scale(up, stand_back_h)),
        yz_add(yz_add(p_rear, yz_scale(up, stand_back_h)),
               yz_scale(rear_out, stand_support_t)),
        yz_add(p_rear, yz_scale(rear_out, stand_support_t))
    ];
    front_lip = [
        p_front,
        yz_add(p_front, yz_scale(up, stand_front_lip_h)),
        yz_add(yz_add(p_front, yz_scale(up, stand_front_lip_h)),
               yz_scale(front_out, stand_support_t)),
        yz_add(p_front, yz_scale(front_out, stand_support_t))
    ];
    bottom_saddle = [
        p_rear,
        p_front,
        yz_add(p_front, yz_scale(bottom_out, stand_support_t)),
        yz_add(p_rear, yz_scale(bottom_out, stand_support_t))
    ];

    // End cheeks bridge the lower cradle at each side and stop lateral slip.
    front_outer = yz_add(p_front, yz_scale(front_out, stand_support_t));
    rear_outer = yz_add(p_rear, yz_scale(rear_out, stand_support_t));
    side_cheek = [
        front_outer,
        yz_add(front_outer, yz_scale(up, stand_side_h)),
        yz_add(rear_outer, yz_scale(up, stand_side_h)),
        rear_outer
    ];

    difference() {
        union() {
            // Wide, stable desktop footprint.
            translate([-stand_w/2, -stand_depth/2, 0])
                cube([stand_w, stand_depth, stand_base_t]);

            // Four actual contact surfaces: tilted floor, rear support, front
            // retaining lip, and two end cheeks.
            yz_extrude(bottom_saddle, stand_w);
            yz_extrude(rear_plate, stand_w);
            yz_extrude(front_lip, stand_w);
            for (x = [-slot_w/2-stand_side_t/2,
                       slot_w/2+stand_side_t/2])
                yz_extrude(side_cheek, stand_side_t, x);
        }

        // Open cable route from the bottom/rear-mounted USB-C connector to the
        // BACK of the stand.  The front retaining lip stays continuous while
        // the rear support is notched only at its lower centre.
        translate([-stand_cable_channel_w/2,
                   8,
                   stand_base_t])
            cube([stand_cable_channel_w,
                  stand_depth/2 - 8 + 0.5,
                  14]);
    }
}

module stand_device_proxy() {
    slot_d = assembled_external_depth;
    pivot_z = stand_base_t +
              (assembled_external_depth + 2*stand_slot_clearance)/2 *
              sin(stand_angle);
    translate([0, 0, pivot_z])
        rotate([-stand_angle, 0, 0])
            translate([-case_w/2, -slot_d/2, 0])
                cube([case_w, slot_d, case_h]);
}

module stand_fit_preview() {
    color([0.05, 0.05, 0.08, 1]) desktop_stand();
    color([0.28, 0.32, 0.30, 0.55]) stand_device_proxy();
}

module enclosure_in_stand_transform() {
    pivot_z = stand_base_t +
              (assembled_external_depth + 2*stand_slot_clearance)/2 *
              sin(stand_angle);
    translate([0, 0, pivot_z])
        rotate([-stand_angle, 0, 0])
            multmatrix([
                [1, 0, 0, 0],
                [0, 0, 1, -assembled_external_depth/2],
                [0, 1, 0, case_h/2],
                [0, 0, 0, 1]
            ]) children();
}

module stand_real_assembly_preview() {
    color([0.04, 0.04, 0.06, 1]) desktop_stand();
    enclosure_in_stand_transform() {
        color([0.03, 0.03, 0.035, 1]) front_bezel();
        color([0.20, 0.23, 0.22, 0.55])
            translate([0, 0, front_plate_t]) rear_tub();
    }
}

module assembly_preview() {
    // Exploded layout for inspection; export each part separately for printing.
    color([0.05, 0.05, 0.05, 1])
        translate([-case_w-8, 0, 0]) front_bezel();
    color([0.18, 0.20, 0.22, 0.45])
        translate([8, 0, 0]) rear_tub();
    color([0.05, 0.05, 0.05, 1])
        translate([case_w+30, 0, 0]) desktop_stand();
}

module shell_collision_check() {
    intersection() {
        front_bezel();
        // Tiny diagnostic separation avoids reporting the intended coplanar
        // front-rim contact as a false collision surface.
        translate([0, 0, front_plate_t + 0.01]) rear_tub();
    }
}

if (selected_part == "front") front_bezel();
else if (selected_part == "back") rear_tub();
else if (selected_part == "stand") desktop_stand();
else if (selected_part == "stand_fit") stand_fit_preview();
else if (selected_part == "stand_assembly") stand_real_assembly_preview();
else if (selected_part == "collision") shell_collision_check();
else assembly_preview();
