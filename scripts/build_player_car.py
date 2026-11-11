"""
NIGHTSHIFT — Original Studio-Grade Hero Supercar Generator (Blender 4.3 Headless)
Generates `public/assets/models/player_car.glb` 100% from scratch in Python (CC0 / Original Project Asset).

Design: "NIGHTSHIFT V12 GT" — Unbranded modern mid-engine twin-turbo exotic GT supercar.
Architecture (Pass 2 — True Catmull-Clark Subdivision Multi-Panel Class-A Surface):
  - Pure-quad Catmull-Clark subdivided (`SUBSURF levels=2`) body panels with inward-rolled 3D shut-line flanges:
      * Radial-lofted Flared Front Fenders & Widebody Muscular Rear Quarters (zero-pole circular wheel arches)
      * Separate Sculpted Bonnet / Hood with Central Aero Spine & Recessed Carbon Extractor Vents
      * Separate Front Bumper Fascia with Deep Hex-Mesh Intakes, Painted Aero Fangs & 2x2 Twill Carbon Splitter
      * Flush Recessed Angular Supercar Headlamps (Cheekbone LED DRL Blades + Twin Bi-LED Projectors + Flush Clear Lenses)
      * Separate Left & Right Sculpted Doors with Deep Aerodynamic Side Scallops, Flush Handles & Carbon Side Skirts
      * Integrated Mid-Engine Side Air Intakes with Carbon Bezel Trim, Aero Splitter Vane & Honeycomb Throat
      * Continuous Subdivided Teardrop Canopy Glasshouse + Gloss-Black A-Pillars + Double-Bubble Carbon Roof + Flying Buttresses
      * Smoked Glass Mid-Engine Showcase Bay with Twin-Plenum V12 Manifold, Strut X-Brace & Carbon Louvers
      * Sculpted Concave Kammback Rear Cove, Curved 3D Ruby Horizon Light-Blade + Outboard Twin-Slash LED Blades
      * High-Mounted Twin Burnt-Titanium Exhaust Canons + Dark Curved 6-Strake Carbon Venturi Diffuser (exposing 325mm rear tires)
      * Top-Mounted Swan-Neck 3D Cambered Carbon GT Wing + Twin-Stalk Aerodynamic Wing Mirrors
      * Cockpit Interior Silhouette (Alcantara Dash Binnacle, Digital Gauge Glow, Bucket Seats, Live Articulated Steering Wheel)
      * Open-Outer-Face Wheelhouse Arch Liners + Staggered 20"/21" 5-Twin-Y-Spoke Forged Center-Lock Wheels,
        Grooved Wet UHP Tires, Slotted Carbon-Ceramic Brake Discs ('Disc'), and Stationary 6-Piston Crimson Calipers ('BrakePad')
  - Coordinate convention (exported with export_yup=True):
      * Blender +Y (Front) -> glTF -Z (Forward in Three.js)
      * Blender -Y (Rear)  -> glTF +Z (Rear in Three.js)
      * Blender +X (Right) -> glTF +X (Right in Three.js)
      * Blender +Z (Up)    -> glTF +Y (Up in Three.js)
"""

import bpy
import bmesh
import math
import mathutils
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_PATH = os.path.join(ROOT, "public", "assets", "models", "player_car.glb")
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

# Overall Hero Supercar Key Dimensions (meters, Blender Z-up, +Y forward)
AXLE_FRONT_Y = 1.36
AXLE_REAR_Y = -1.34
WHEEL_FRONT_R = 0.350
WHEEL_REAR_R = 0.368
TRACK_FRONT_X = 0.852
TRACK_REAR_X = 0.855
ARCH_FRONT_R = 0.376
ARCH_REAR_R = 0.394


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 0.0
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def catmull_rom_1d(pts, x):
    """Smooth C1 Hermite spline over sorted (x_i, y_i) stations."""
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    n = len(pts)
    idx = 0
    for i in range(n - 1):
        if pts[i][0] <= x <= pts[i + 1][0]:
            idx = i
            break
    x0, y0 = pts[idx]
    x1, y1 = pts[idx + 1]
    dx = x1 - x0
    if dx < 1e-6:
        return y0
    if idx > 0:
        m0 = 0.5 * ((y1 - y0) / dx + (y0 - pts[idx - 1][1]) / max(1e-6, x0 - pts[idx - 1][0]))
    else:
        m0 = (y1 - y0) / dx
    if idx + 2 < n:
        m1 = 0.5 * ((pts[idx + 2][1] - y1) / max(1e-6, pts[idx + 2][0] - x1) + (y1 - y0) / dx)
    else:
        m1 = (y1 - y0) / dx
    t = (x - x0) / dx
    t2 = t * t
    t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * dx * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * dx * m1


# ==============================================================================
# 1. PROCEDURAL PBR MICRO-DETAIL TEXTURES & MATERIALS
# ==============================================================================

def create_carbon_weave_textures():
    """Synthesizes tileable 2x2 twill carbon-fiber albedo + tangent normal maps."""
    size = 128
    albedo_img = bpy.data.images.new("CarbonTwillAlbedo", width=size, height=size, alpha=False)
    norm_img = bpy.data.images.new("CarbonTwillNormal", width=size, height=size, alpha=False)
    norm_img.colorspace_settings.name = 'Non-Color'

    alb_px = [0.0] * (size * size * 4)
    nrm_px = [0.0] * (size * size * 4)
    cell = 8  # 16x16 twill tows per tile

    for py in range(size):
        for px in range(size):
            tx = px // cell
            ty = py // cell
            fx = (px % cell) / float(cell)
            fy = (py % cell) / float(cell)
            phase = (tx + ty) % 4
            if phase < 2:
                crown = math.sin(fy * math.pi)
                sx, sy = 0.0, math.cos(fy * math.pi) * 0.42
                val = 0.045 + 0.055 * crown
            else:
                crown = math.sin(fx * math.pi)
                sx, sy = math.cos(fx * math.pi) * 0.42, 0.0
                val = 0.025 + 0.038 * crown

            nx, ny, nz = -sx, -sy, 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            idx = (py * size + px) * 4
            alb_px[idx + 0] = val * 0.96
            alb_px[idx + 1] = val * 0.99
            alb_px[idx + 2] = val * 1.05
            alb_px[idx + 3] = 1.0
            nrm_px[idx + 0] = (nx * inv) * 0.5 + 0.5
            nrm_px[idx + 1] = (ny * inv) * 0.5 + 0.5
            nrm_px[idx + 2] = (nz * inv) * 0.5 + 0.5
            nrm_px[idx + 3] = 1.0

    albedo_img.pixels[:] = alb_px
    norm_img.pixels[:] = nrm_px
    albedo_img.pack()
    norm_img.pack()
    return albedo_img, norm_img


def create_rotor_texture():
    """Synthesizes a radial machined + J-hook slotted / cross-drilled carbon-ceramic rotor map."""
    size = 256
    img = bpy.data.images.new("BrakeRotorAlbedo", width=size, height=size, alpha=False)
    px = [0.0] * (size * size * 4)
    half = size * 0.5

    for y in range(size):
        for x in range(size):
            dx = (x - half + 0.5) / half
            dy = (y - half + 0.5) / half
            r = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            grain = 0.28 + 0.04 * math.sin(r * 160.0) + 0.015 * math.cos(ang * 24.0)
            if 0.44 < r < 0.94:
                slot_phase = ((ang / (2.0 * math.pi)) * 10.0 - r * 0.58) % 1.0
                if slot_phase < 0.055:
                    grain *= 0.15
                hole_phase = ((ang / (2.0 * math.pi)) * 10.0 - r * 0.58 + 0.5) % 1.0
                for hr in (0.54, 0.68, 0.82):
                    if abs(r - hr) < 0.026 and abs(hole_phase - 0.5) < 0.045:
                        grain *= 0.12
            elif r <= 0.44:
                grain = 0.05
                # 10 floating-rotor bobbin pins around inner bell
                bob_phase = ((ang / (2.0 * math.pi)) * 10.0) % 1.0
                if abs(r - 0.40) < 0.028 and abs(bob_phase - 0.5) < 0.08:
                    grain = 0.45

            idx = (y * size + x) * 4
            px[idx + 0] = grain * 0.98
            px[idx + 1] = grain * 0.99
            px[idx + 2] = grain * 1.02
            px[idx + 3] = 1.0

    img.pixels[:] = px
    img.pack()
    return img


def build_materials():
    carbon_alb, carbon_nrm = create_carbon_weave_textures()
    rotor_alb = create_rotor_texture()

    def pbr(name, color, metallic=0.0, roughness=0.35, coat=0.0, coat_rough=0.04,
            emission=None, emission_strength=0.0, alpha=1.0):
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat
            bsdf.inputs["Coat Roughness"].default_value = coat_rough
        if emission is not None and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
        if alpha < 1.0:
            bsdf.inputs["Alpha"].default_value = alpha
            if hasattr(mat, "blend_method"):
                mat.blend_method = 'BLEND'
        return mat

    # 1. Deep Rosso-Midnight Metallic Basecoat + Mirror Clearcoat ("Paint 1 Carmine")
    mat_paint = pbr(
        "Paint 1 Carmine",
        (0.21, 0.004, 0.009),
        metallic=0.56,
        roughness=0.17,
        coat=1.0,
        coat_rough=0.022,
    )

    # 2. Rich Dark 2x2 Twill Carbon Fiber ("Paint 2 Carbon")
    mat_carbon = pbr(
        "Paint 2 Carbon",
        (0.022, 0.024, 0.028),
        metallic=0.18,
        roughness=0.26,
        coat=0.85,
        coat_rough=0.070,
    )
    nt = mat_carbon.node_tree
    bsdf_c = nt.nodes.get("Principled BSDF")
    alb_node = nt.nodes.new("ShaderNodeTexImage")
    alb_node.image = carbon_alb
    nt.links.new(alb_node.outputs["Color"], bsdf_c.inputs["Base Color"])

    nrm_tex = nt.nodes.new("ShaderNodeTexImage")
    nrm_tex.image = carbon_nrm
    nrm_map = nt.nodes.new("ShaderNodeNormalMap")
    nrm_map.inputs["Strength"].default_value = 0.65
    nt.links.new(nrm_tex.outputs["Color"], nrm_map.inputs["Color"])
    nt.links.new(nrm_map.outputs["Normal"], bsdf_c.inputs["Normal"])

    # 3. Gloss Piano-Black Trim, Matte Chassis Tub & Dark Hex Grille
    mat_gloss_black = pbr("GlossBlackTrim", (0.008, 0.009, 0.012), metallic=0.25, roughness=0.06, coat=1.0, coat_rough=0.02)
    mat_matte_tub = pbr("MatteUnderbody", (0.009, 0.010, 0.012), metallic=0.10, roughness=0.82)
    mat_grille = pbr("GrilleDark", (0.012, 0.014, 0.018), metallic=0.60, roughness=0.44)

    # 4. Tinted Automotive Glass, Flush Headlamp Polycarbonate & Chrome Mirror
    mat_glass = pbr("Glass", (0.012, 0.018, 0.028), metallic=0.08, roughness=0.02, coat=1.0, coat_rough=0.01, alpha=0.84)
    mat_lens = pbr("LensGlass", (0.62, 0.76, 0.92), metallic=0.04, roughness=0.018, coat=1.0, coat_rough=0.01, alpha=0.26)
    mat_mirror = pbr("MirrorGlass", (0.92, 0.95, 0.99), metallic=1.0, roughness=0.015)

    # 5. Forged Satin-Titanium Gunmetal Rim, Wet UHP Tire, Slotted Rotor ('Disc'), Crimson Caliper, Titanium Exhaust
    mat_rim = pbr("RimForged", (0.095, 0.105, 0.125), metallic=0.92, roughness=0.18, coat=0.65, coat_rough=0.05)
    mat_tire = pbr("Tiretread", (0.014, 0.016, 0.019), metallic=0.04, roughness=0.48)
    mat_caliper = pbr("CaliperCrimson", (0.42, 0.010, 0.016), metallic=0.72, roughness=0.18, coat=0.95, coat_rough=0.035)
    mat_exhaust = pbr("TitaniumExhaust", (0.32, 0.30, 0.38), metallic=0.96, roughness=0.14)

    mat_disc = pbr("Disc", (0.36, 0.37, 0.40), metallic=0.88, roughness=0.25)
    nt_d = mat_disc.node_tree
    bsdf_d = nt_d.nodes.get("Principled BSDF")
    rot_node = nt_d.nodes.new("ShaderNodeTexImage")
    rot_node.image = rotor_alb
    nt_d.links.new(rot_node.outputs["Color"], bsdf_d.inputs["Base Color"])

    # 6. Emissive Lighting Signatures & Cockpit Materials
    mat_headlight = pbr("Headlight", (0.94, 0.98, 1.0), metallic=0.0, roughness=0.06, emission=(0.86, 0.94, 1.0), emission_strength=9.5)
    mat_brakelight = pbr("Brakelight", (0.30, 0.005, 0.012), metallic=0.0, roughness=0.08, emission=(1.0, 0.035, 0.075), emission_strength=10.0)
    mat_signal = pbr("Signallight", (0.36, 0.12, 0.0), metallic=0.0, roughness=0.10, emission=(1.0, 0.36, 0.02), emission_strength=2.6)
    mat_cockpit = pbr("CockpitAlcantara", (0.020, 0.022, 0.026), metallic=0.06, roughness=0.76)
    mat_seat_accent = pbr("SeatLeatherCrimson", (0.18, 0.014, 0.020), metallic=0.10, roughness=0.42)
    mat_gauge = pbr("GaugeGlow", (0.05, 0.25, 0.45), metallic=0.0, roughness=0.15, emission=(0.18, 0.72, 1.0), emission_strength=4.5)

    return {
        "paint": mat_paint,
        "carbon": mat_carbon,
        "gloss_black": mat_gloss_black,
        "tub": mat_matte_tub,
        "grille": mat_grille,
        "glass": mat_glass,
        "lens": mat_lens,
        "mirror": mat_mirror,
        "rim": mat_rim,
        "tire": mat_tire,
        "disc": mat_disc,
        "caliper": mat_caliper,
        "exhaust": mat_exhaust,
        "headlight": mat_headlight,
        "brakelight": mat_brakelight,
        "signal": mat_signal,
        "cockpit": mat_cockpit,
        "seat_accent": mat_seat_accent,
        "gauge": mat_gauge,
    }


# ==============================================================================
# 2. SUBDIVISION QUAD-GRID & LOFT HELPERS
# ==============================================================================

def create_mesh_obj(name, bm, mat, subsurf_levels=0, solidify_thickness=0.0, recalc_normals=True):
    """Converts a BMesh into a smooth-shaded Blender object with optional Solidify & Catmull-Clark Subsurf."""
    if recalc_normals:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)

    if solidify_thickness > 0.0:
        sol = obj.modifiers.new("Solidify", 'SOLIDIFY')
        sol.thickness = solidify_thickness
        sol.offset = -1.0
        sol.use_even_offset = True

    if subsurf_levels > 0:
        mod = obj.modifiers.new("Subsurf", 'SUBSURF')
        mod.levels = subsurf_levels
        mod.render_levels = subsurf_levels
        mod.uv_smooth = 'PRESERVE_BOUNDARIES'
    return obj


def build_grid_with_flange(
    name,
    grid_pts,
    mat,
    subsurf_levels=2,
    flange_vec_fn=None,
    outward_dir=(0.0, 0.0, 1.0),
    solidify_thickness=0.0,
):
    """
    Builds a 100% manifold-consistent pure-quad mesh from `grid_pts[i][j]`,
    adds boundary support loops + optional 3D inward shut-line flange, and verifies
    exact outward normal orientation against `outward_dir` (zero Möbius seams or flipped panels!).
    """
    M = len(grid_pts)
    N = len(grid_pts[0])
    pts = [[mathutils.Vector(p) for p in row] for row in grid_pts]

    def expand_rows(arr):
        r0 = [arr[0][j].lerp(arr[1][j], 0.16) for j in range(len(arr[0]))]
        r1 = [arr[-1][j].lerp(arr[-2][j], 0.16) for j in range(len(arr[0]))]
        return [arr[0], r0] + arr[1:-1] + [r1, arr[-1]]

    def expand_cols(arr):
        out = []
        for row in arr:
            c0 = row[0].lerp(row[1], 0.16)
            c1 = row[-1].lerp(row[-2], 0.16)
            out.append([row[0], c0] + row[1:-1] + [c1, row[-1]])
        return out

    if M >= 3 and N >= 3 and subsurf_levels > 0:
        pts = expand_cols(expand_rows(pts))
        M = len(pts)
        N = len(pts[0])

    bm = bmesh.new()
    vgrid = [[bm.verts.new(pts[i][j]) for j in range(N)] for i in range(M)]

    main_faces = []
    for i in range(M - 1):
        for j in range(N - 1):
            f = bm.faces.new((vgrid[i][j], vgrid[i + 1][j], vgrid[i + 1][j + 1], vgrid[i][j + 1]))
            main_faces.append(f)

    if flange_vec_fn is not None:
        perim = []
        for j in range(N):
            perim.append(vgrid[0][j])
        for i in range(1, M):
            perim.append(vgrid[i][N - 1])
        for j in range(N - 2, -1, -1):
            perim.append(vgrid[M - 1][j])
        for i in range(M - 2, 0, -1):
            perim.append(vgrid[i][0])

        flange_verts = [bm.verts.new(v.co + mathutils.Vector(flange_vec_fn(v.co))) for v in perim]
        L = len(perim)
        for k in range(L):
            kn = (k + 1) % L
            # Shared edge (perim[k] -> perim[kn]) is opposite to main grid's (perim[kn] -> perim[k])!
            bm.faces.new((perim[k], perim[kn], flange_verts[kn], flange_verts[k]))

    bm.normal_update()
    avg_n = mathutils.Vector((0.0, 0.0, 0.0))
    for f in main_faces:
        avg_n += f.normal
    if avg_n.dot(mathutils.Vector(outward_dir)) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update()

    return create_mesh_obj(
        name,
        bm,
        mat,
        subsurf_levels=subsurf_levels,
        solidify_thickness=solidify_thickness,
        recalc_normals=False,
    )


def add_beveled_box(name, center, half_extents, mat, bevel_w=0.004, rot_euler=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    hx, hy, hz = half_extents
    rot_m = mathutils.Euler(rot_euler, 'XYZ').to_matrix()
    c_vec = mathutils.Vector(center)
    for v in bm.verts:
        local = mathutils.Vector((v.co.x * 2.0 * hx, v.co.y * 2.0 * hy, v.co.z * 2.0 * hz))
        v.co = c_vec + (rot_m @ local)
    if bevel_w > 0.0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel_w, segments=2, affect='EDGES')
    return create_mesh_obj(name, bm, mat, subsurf_levels=0)


# ==============================================================================
# 3. MASTER ANALYTIC AUTOMOTIVE SEAM & PROPORTION CURVES
# ==============================================================================

# Seam between Bonnet/Hood and Front Fenders (y from +0.82 windshield cowl to +1.96 nose)
HOOD_SEAM_X_PTS = [
    (0.82, 0.590),
    (1.12, 0.570),
    (1.42, 0.540),
    (1.72, 0.495),
    (1.98, 0.440),
]

HOOD_SEAM_Z_PTS = [
    (0.82, 0.768),
    (1.10, 0.748),
    (1.38, 0.715),
    (1.68, 0.635),
    (1.98, 0.500),
]

# Hood centerline height (y from +0.82 cowl to +2.02 front bumper seam)
HOOD_CENTER_Z_PTS = [
    (0.82, 0.752),
    (1.12, 0.728),
    (1.42, 0.688),
    (1.72, 0.602),
    (2.02, 0.468),
]

# Front Fender peak crest height (rises sensuously ABOVE hood seam so HOOD CAM sees gorgeous GT fenders!)
FRONT_FENDER_CREST_Z_PTS = [
    (0.80, 0.782),
    (1.08, 0.790),
    (1.36, 0.792),
    (1.64, 0.720),
    (1.88, 0.585),
    (2.06, 0.465),
]

# Rear Deck / Engine-Bay-to-Rear-Haunch seam (y from -0.72 to -2.18)
REAR_DECK_SEAM_X_PTS = [
    (-2.18, 0.500),
    (-1.80, 0.515),
    (-1.34, 0.525),
    (-0.74, 0.535),
]

REAR_DECK_SEAM_Z_PTS = [
    (-2.18, 0.755),
    (-1.80, 0.795),
    (-1.34, 0.855),
    (-0.74, 0.945),
]

# Muscular Rear Haunch outer crest (swells voluptuously over 21" rear wheels, tapers to Kammback tail!)
REAR_HAUNCH_X_PTS = [
    (-2.20, 0.875),
    (-1.90, 0.945),
    (-1.55, 1.005),
    (-1.34, 1.022),
    (-1.05, 1.000),
    (-0.75, 0.945),
]

REAR_HAUNCH_CREST_Z_PTS = [
    (-2.20, 0.758),
    (-1.88, 0.818),
    (-1.55, 0.868),
    (-1.34, 0.882),
    (-1.02, 0.858),
    (-0.75, 0.820),
]


def tail_curve_y(abs_x):
    """Curved Kammback rear planform: center trails slightly further back than outboard corners."""
    u = clamp(abs_x / 0.89, 0.0, 1.2)
    return -2.215 + 0.095 * (u * u)


# ==============================================================================
# 4. UNDERBODY, INNER CHASSIS TUB & OPEN-OUTER-FACE WHEELHOUSE ARCH LINERS
# ==============================================================================

def build_underbody_and_open_wheelhouses(mats):
    """
    Builds the dark aerodynamic floor, inner chassis sill walls behind every shut-line,
    and OPEN-OUTER-FACE wheel-arch liners (inboard wall strictly at |x|=0.56m, curved upper
    arch baffle above r=R_arch+0.010m with ZERO outer cap so rims, rotors & calipers are 100% visible!).
    """
    # 1. Stepped Aerodynamic Ground-Effect Floor Pan + Recessed Inner Tub Core
    #    Strictly inset well inside hood slope (z <= hood_z - 0.07) and door scallops (|x| <= 0.70 above floor)!
    bm = bmesh.new()
    # (y, floor_hw, upper_hw, top_z)
    tub_stations = [
        (-2.06, 0.54, 0.46, 0.56),
        (-1.78, 0.54, 0.50, 0.64),
        (-0.90, 0.54, 0.52, 0.68),
        (-0.74, 0.90, 0.68, 0.68),
        ( 0.00, 0.90, 0.68, 0.68),
        ( 0.80, 0.90, 0.68, 0.66),
        ( 0.94, 0.54, 0.50, 0.62),
        ( 1.40, 0.54, 0.46, 0.55),
        ( 1.76, 0.52, 0.42, 0.44),
        ( 2.04, 0.44, 0.36, 0.28),
    ]
    rings = []
    for (y, f_hw, u_hw, top_z) in tub_stations:
        bot_z = 0.132
        mid_z = 0.195
        prof = [
            (-f_hw, bot_z),
            ( f_hw, bot_z),
            ( f_hw, mid_z),
            ( u_hw, top_z),
            (-u_hw, top_z),
            (-f_hw, mid_z),
        ]
        rings.append([bm.verts.new((px, y, pz)) for (px, pz) in prof])

    np_t = 6
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(np_t):
            jn = (j + 1) % np_t
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))
    create_mesh_obj("MonocoqueInnerTub", bm, mats["tub"], subsurf_levels=0)

    # 2. Open-Outer-Face Curved Wheelhouse Arch Liners (strictly r = R_arch + 0.010, NO outer disc cap!)
    arch_specs = [
        ("FrontArchLinerL", -1.0, AXLE_FRONT_Y, WHEEL_FRONT_R, ARCH_FRONT_R + 0.008, 0.975, -0.45, math.pi + 0.45),
        ("FrontArchLinerR",  1.0, AXLE_FRONT_Y, WHEEL_FRONT_R, ARCH_FRONT_R + 0.008, 0.975, -0.45, math.pi + 0.45),
        ("RearArchLinerL",  -1.0, AXLE_REAR_Y,  WHEEL_REAR_R,  ARCH_REAR_R + 0.008,  1.005, -0.45, math.pi + 0.28),
        ("RearArchLinerR",   1.0, AXLE_REAR_Y,  WHEEL_REAR_R,  ARCH_REAR_R + 0.008,  1.005, -0.45, math.pi + 0.28),
    ]
    for aname, side, ay, az, ar, x_out_abs, th0, th1 in arch_specs:
        bm = bmesh.new()
        x_in = side * 0.555
        x_out = side * x_out_abs
        arc_pts = 20
        row_in = []
        row_out = []
        row_back = []
        for k in range(arc_pts):
            th = lerp(th0, th1, k / (arc_pts - 1.0))
            py = ay + ar * math.cos(th)
            pz = max(0.135, az + ar * math.sin(th))
            row_in.append(bm.verts.new((x_in, py, pz)))
            row_out.append(bm.verts.new((x_out, py, pz)))
            row_back.append(bm.verts.new((x_in, ay, az)))

        for k in range(arc_pts - 1):
            # Curved arch liner shell (visible when looking up into the fender gap)
            q1 = (row_in[k], row_out[k], row_out[k + 1], row_in[k + 1])
            # Inboard wheelhouse bulkhead wall at |x| = 0.555 (deep behind the wheel & brake disc!)
            q2 = (row_back[k], row_in[k], row_in[k + 1], row_back[k + 1])
            if side > 0:
                bm.faces.new(tuple(reversed(q1)))
                bm.faces.new(tuple(reversed(q2)))
            else:
                bm.faces.new(q1)
                bm.faces.new(q2)
        create_mesh_obj(aname, bm, mats["tub"], subsurf_levels=0, solidify_thickness=0.005, recalc_normals=False)


# ==============================================================================
# 5. TRUE CATMULL-CLARK SUBDIVIDED MULTI-PANEL EXTERIOR BODYWORK
# ==============================================================================

def build_bonnet_panel(mats):
    """
    Separate Sculpted Bonnet / Hood (`SUBSURF levels=2`):
    Features smooth central aero valley, crisp centerline power spine, and two sunken carbon vents.
    """
    ny = 9
    nx = 9
    y_vals = [lerp(0.832, 2.015, i / (ny - 1.0)) for i in range(ny)]
    u_vals = [lerp(-1.0, 1.0, j / (nx - 1.0)) for j in range(nx)]

    grid = []
    for y in y_vals:
        w_seam = catmull_rom_1d(HOOD_SEAM_X_PTS, y) - 0.0025  # 2.5mm shut-line clearance
        z_edge = catmull_rom_1d(HOOD_SEAM_Z_PTS, y)
        z_ctr = catmull_rom_1d(HOOD_CENTER_Z_PTS, y)
        row = []
        for u in u_vals:
            au = abs(u)
            px = u * w_seam
            # Sculpted GT valley at |u| ~ 0.45 + subtle crisp power spine at u = 0
            valley = -0.020 * math.sin(au * math.pi) * smoothstep(2.01, 1.02, y)
            spine = 0.012 * math.exp(-((u / 0.16) ** 2)) * smoothstep(2.00, 0.98, y)
            vent_mask = (
                smoothstep(0.28, 0.38, au) * smoothstep(0.74, 0.64, au)
                * smoothstep(1.16, 1.26, y) * smoothstep(1.68, 1.56, y)
            )
            pz = lerp(z_ctr, z_edge, au ** 1.45) + valley + spine - 0.018 * vent_mask
            row.append((px, y, pz))
        grid.append(row)

    build_grid_with_flange(
        "Panel_Bonnet",
        grid,
        mats["paint"],
        subsurf_levels=2,
        flange_vec_fn=lambda co: (0.0, 0.0, -0.009),
        outward_dir=(0.0, 0.2, 1.0),
    )

    # Flush recessed dark-carbon hood extractor slats nestled inside the sunken hood pockets
    for side in (-1.0, 1.0):
        for k in range(3):
            vy = 1.28 + k * 0.12
            w_seam = catmull_rom_1d(HOOD_SEAM_X_PTS, vy)
            vx = side * w_seam * 0.50
            z_base = lerp(catmull_rom_1d(HOOD_CENTER_Z_PTS, vy), catmull_rom_1d(HOOD_SEAM_Z_PTS, vy), 0.50 ** 1.45) - 0.020
            add_beveled_box(
                f"HoodExtractorSlat_{'L' if side < 0 else 'R'}_{k}",
                (vx, vy, z_base - 0.010),
                (0.068, 0.024, 0.0035),
                mats["carbon"],
                bevel_w=0.0015,
                rot_euler=(0.24, side * 0.08, side * -0.08),
            )


def build_front_fenders(mats):
    """
    Radial-to-Perimeter Pure-Quad Lofted Front Fenders (`SUBSURF levels=2`):
    Zero-pole circular wheel arch rolling smoothly into high GT fender crests & interlocked shut-lines.
    """
    th_rear = math.pi + 0.56
    th_front = -0.52
    n_ang = 21

    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        s_rings = [[] for _ in range(6)]

        for k in range(n_ang):
            u = k / (n_ang - 1.0)
            th = lerp(th_rear, th_front, u)
            ay = AXLE_FRONT_Y + ARCH_FRONT_R * math.cos(th)
            az = max(0.145, WHEEL_FRONT_R + ARCH_FRONT_R * math.sin(th))
            ax_lip = side * 0.990

            flare_r = ARCH_FRONT_R + 0.028
            fy = AXLE_FRONT_Y + flare_r * math.cos(th)
            fz = max(0.150, WHEEL_FRONT_R + flare_r * math.sin(th))
            fx = side * (0.996 - 0.012 * (math.sin(th) ** 2))

            # Exact interlocked outer perimeter P_outer(u) with corner holding control points:
            # u in [0.00..0.25]: rises along exact Door front cross-section (y = 0.822) to beltline (0.838, 0.768)
            # u in [0.25..0.35]: sweeps across cowl shoulder from beltline (0.838) to Hood seam (0.592)
            # u in [0.35..0.70]: runs forward along Hood seam (y = 0.832 -> 1.960)
            # u in [0.70..0.85]: frames exact upper brow of Recessed Headlamp (x: 0.455 -> 0.905, y: 1.96 -> 1.745)
            # u in [0.85..1.00]: drops cleanly down Front Bumper cheek seam (y = 1.745, z: 0.575 -> 0.152)
            if u <= 0.25:
                tu = u / 0.25
                oy = 0.822
                oz = lerp(0.156, 0.768, tu)
                base_bulge = 0.032 * math.sin(tu * math.pi)
                shoulder_kick = 0.010 * math.exp(-(((tu - 0.88) / 0.10) ** 2))
                ox = side * (lerp(0.965, 0.836, tu ** 1.35) + base_bulge + shoulder_kick)
            elif u <= 0.35:
                tu = (u - 0.25) / 0.10
                oy = lerp(0.822, 0.832, tu)
                oz = lerp(0.768, catmull_rom_1d(HOOD_SEAM_Z_PTS, 0.832), tu)
                ox = side * lerp(0.838, catmull_rom_1d(HOOD_SEAM_X_PTS, 0.832) + 0.0025, smoothstep(0.0, 1.0, tu))
            elif u <= 0.70:
                tu = (u - 0.35) / 0.35
                oy = lerp(0.832, 1.960, tu)
                oz = catmull_rom_1d(HOOD_SEAM_Z_PTS, oy)
                ox = side * (catmull_rom_1d(HOOD_SEAM_X_PTS, oy) + 0.0025)
            elif u <= 0.85:
                tu = (u - 0.70) / 0.15
                ox = side * lerp(0.455, 0.905, tu)
                oy = lerp(1.985, 1.745, tu ** 1.15)
                oz = lerp(0.500, 0.575, tu ** 0.9)
            else:
                tu = (u - 0.85) / 0.15
                ox = side * lerp(0.905, 0.955, tu)
                oy = 1.745
                oz = lerp(0.575, 0.152, tu)

            mid_y = lerp(fy, oy, 0.52)
            crest_boost = 0.054 * math.sin(clamp((u - 0.22) / 0.58, 0.0, 1.0) * math.pi)
            mid_z = lerp(fz, oz, 0.48) + crest_boost
            mid_x = side * (lerp(abs(fx), abs(ox), 0.36) + 0.015 * math.sin(clamp(u, 0.0, 1.0) * math.pi))

            p0 = (ax_lip - side * 0.026, ay, az)
            p1 = (ax_lip, ay, az)
            p2 = (fx, fy, fz)
            p3 = (mid_x, mid_y, mid_z)
            p4 = (lerp(mid_x, ox, 0.72), lerp(mid_y, oy, 0.72), lerp(mid_z, oz, 0.76))
            p5 = (ox, oy, oz)

            for idx, pt in enumerate((p0, p1, p2, p3, p4, p5)):
                s_rings[idx].append(pt)

        build_grid_with_flange(
            f"Panel_FrontFender_{sfx}",
            s_rings,
            mats["paint"],
            subsurf_levels=2,
            flange_vec_fn=lambda co, s=side: (-s * 0.007, 0.0, -0.006),
            outward_dir=(side, 0.1, 0.5),
        )


def build_front_bumper_and_headlamps(mats):
    """
    Sculpted Front Bumper Fascia (`SUBSURF levels=2`), Recessed Hex-Mesh Intakes,
    Tucked Carbon Intake Vanes, 2x2 Twill Carbon Front Splitter, and Interlocked Flush Headlamps.
    """
    u_vals = [lerp(-1.0, 1.0, j / 14.0) for j in range(15)]
    beak_grid = []
    for v in (0.0, 0.28, 0.62, 0.85, 1.0):
        row = []
        for u in u_vals:
            au = abs(u)
            px = u * lerp(0.955, 0.945, v)
            y_tip = 2.275 - 0.525 * (au ** 1.58)
            y_top = lerp(2.020, 1.745, smoothstep(0.42, 0.96, au))
            py = lerp(y_tip, y_top, v)

            z_low = lerp(0.335, 0.152, smoothstep(0.50, 0.90, au))
            z_high = lerp(0.472, 0.425, smoothstep(0.38, 0.82, au))
            pz = lerp(z_low, z_high, v)
            row.append((px, py, pz))
        beak_grid.append(row)

    build_grid_with_flange(
        "Panel_FrontBumperNose",
        beak_grid,
        mats["paint"],
        subsurf_levels=2,
        flange_vec_fn=lambda co: (0.0, -0.012, -0.006),
        outward_dir=(0.0, 1.0, 0.3),
    )

    # Tucked Diagonal Carbon Intake Splitters strictly INSIDE the lower radiator mouth (never protruding past nose!)
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        vane_grid = []
        for s_z in (0.0, 0.5, 1.0):
            pz = lerp(0.132, 0.338, s_z)
            vx_c = lerp(0.48, 0.36, s_z)
            y_front = (2.275 - 0.525 * ((vx_c / 0.955) ** 1.58)) - lerp(0.015, 0.035, s_z)
            vane_grid.append([
                (side * (vx_c - 0.012), y_front - 0.085, pz),
                (side * (vx_c - 0.006), y_front, pz),
                (side * (vx_c + 0.010), y_front - 0.004, pz),
                (side * (vx_c + 0.014), y_front - 0.090, pz),
            ])
        build_grid_with_flange(
            f"FrontIntakeCarbonVane_{sfx}",
            vane_grid,
            mats["carbon"],
            subsurf_levels=1,
            flange_vec_fn=None,
            outward_dir=(side, 1.0, 0.0),
            solidify_thickness=0.007,
        )

        # Horizontal carbon intake aero-blade inside lateral brake-cooling duct
        add_beveled_box(
            f"FrontBrakeDuctBlade_{sfx}",
            (side * 0.60, 1.92, 0.235),
            (0.135, 0.032, 0.006),
            mats["carbon"],
            bevel_w=0.002,
            rot_euler=(0.0, side * 0.14, side * -0.36),
        )

    # Recessed Dark Radiator Honeycomb Grille strictly behind the bumper nose & cheek panels
    bm = bmesh.new()
    g_u = [-0.76, -0.45, 0.0, 0.45, 0.76]
    g_z = [0.132, 0.235, 0.332]
    gv = [[bm.verts.new((ux, 2.02 - 0.36 * (abs(ux) ** 1.5), gz)) for ux in g_u] for gz in g_z]
    for iz in range(len(g_z) - 1):
        for iu in range(len(g_u) - 1):
            bm.faces.new((gv[iz][iu], gv[iz][iu + 1], gv[iz + 1][iu + 1], gv[iz + 1][iu]))
    create_mesh_obj("FrontRadiatorGrille", bm, mats["grille"], subsurf_levels=0, solidify_thickness=0.006, recalc_normals=False)

    sp_u = [lerp(-1.0, 1.0, j / 12.0) for j in range(13)]
    sp_grid = []
    for depth_t in (0.0, 0.55, 1.0):
        row = []
        for u in sp_u:
            au = abs(u)
            px = u * 0.975
            y_lead = 2.335 - 0.485 * (au ** 1.62)
            y_back = 1.960 - 0.210 * (au ** 1.40)
            py = lerp(y_back, y_lead, depth_t)
            spoon = 0.014 * math.exp(-((u / 0.36) ** 2))
            pz = lerp(0.138, 0.118, depth_t) + spoon
            row.append((px, py, pz))
        sp_grid.append(row)

    build_grid_with_flange(
        "FrontCarbonSplitter",
        sp_grid,
        mats["carbon"],
        subsurf_levels=1,
        flange_vec_fn=None,
        outward_dir=(0.0, 0.1, 1.0),
        solidify_thickness=0.008,
    )

    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        add_beveled_box(
            f"SplitterWinglet_{sfx}",
            (side * 0.968, 1.835, 0.175),
            (0.008, 0.085, 0.052),
            mats["carbon"],
            bevel_w=0.003,
            rot_euler=(0.06, 0.0, side * -0.16),
        )

    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        housing_grid = []
        lens_grid = []
        for vt in (0.0, 0.5, 1.0):
            h_row = []
            l_row = []
            for iu in range(5):
                ut = iu / 4.0
                px = side * lerp(0.450, 0.910, ut)
                y_surf = lerp(1.995, 1.745, ut ** 1.15)
                z_bot = lerp(0.422, 0.425, ut)
                z_top = lerp(0.500, 0.575, ut ** 0.9)
                pz = lerp(z_bot, z_top, vt)
                recess = 0.038 * math.sin(ut * math.pi) * math.sin(vt * math.pi)
                h_row.append((px, y_surf - recess, pz - recess * 0.25))
                l_row.append((px, y_surf + 0.002, pz + 0.001))
            housing_grid.append(h_row)
            lens_grid.append(l_row)

        build_grid_with_flange(
            f"HeadlampHousing_{sfx}",
            housing_grid,
            mats["gloss_black"],
            subsurf_levels=1,
            flange_vec_fn=lambda co: (0.0, -0.015, 0.0),
            outward_dir=(side * 0.4, 1.0, 0.3),
        )
        build_grid_with_flange(
            f"HeadlampFlushLens_{sfx}",
            lens_grid,
            mats["lens"],
            subsurf_levels=1,
            flange_vec_fn=None,
            outward_dir=(side * 0.4, 1.0, 0.3),
        )

        bm = bmesh.new()
        drl_pts = [
            (side * 0.475, 1.975, 0.434),
            (side * 0.620, 1.910, 0.448),
            (side * 0.775, 1.825, 0.478),
            (side * 0.885, 1.755, 0.525),
            (side * 0.845, 1.772, 0.556),
        ]
        d_rings = []
        for (dx, dy, dz) in drl_pts:
            w = 0.007
            d_rings.append([
                bm.verts.new((dx - w, dy - w, dz - w)),
                bm.verts.new((dx + w, dy + w, dz - w)),
                bm.verts.new((dx + w, dy + w, dz + w)),
                bm.verts.new((dx - w, dy - w, dz + w)),
            ])
        for i in range(len(d_rings) - 1):
            r0, r1 = d_rings[i], d_rings[i + 1]
            for j in range(4):
                jn = (j + 1) % 4
                bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
        bm.faces.new(tuple(reversed(d_rings[0])))
        bm.faces.new(tuple(d_rings[-1]))
        create_mesh_obj(f"HeadlampDRLBlade_{sfx}", bm, mats["headlight"], subsurf_levels=1)

        for pj, (ux, uy, uz) in enumerate(((0.61, 1.902, 0.472), (0.73, 1.835, 0.496))):
            add_beveled_box(
                f"HeadlampProjector_{sfx}_{pj}",
                (side * ux, uy, uz),
                (0.028, 0.018, 0.015),
                mats["headlight"],
                bevel_w=0.005,
                rot_euler=(0.08, 0.0, side * -0.45),
            )


def build_sculpted_doors_and_mirrors(mats):
    """
    Separate Left & Right Doors (`SUBSURF levels=2`) with deep mid-engine side airflow scallop,
    carbon rocker side-skirts, flush titanium door handles, and aerodynamic twin-stalk mirrors.
    """
    ny = 9
    nz = 7
    y_vals = [lerp(-0.748, 0.818, i / (ny - 1.0)) for i in range(ny)]
    v_vals = [j / (nz - 1.0) for j in range(nz)]

    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        grid = []
        for y in y_vals:
            t_rear = smoothstep(0.818, -0.748, y)
            z_belt = lerp(0.768, 0.816, t_rear)
            # Smoothly tuck leading-top beltline corner into A-pillar / Fender shoulder (0.832 -> 0.885)
            front_tuck = 0.014 * smoothstep(0.62, 0.818, y)
            x_belt = lerp(0.845, 0.885, t_rear) - front_tuck
            x_sill = lerp(0.965, 0.975, t_rear)

            row = []
            for v in v_vals:
                pz = lerp(0.156, z_belt, v)
                base_bulge = 0.032 * math.sin(v * math.pi)
                scallop_depth = 0.082 * (t_rear ** 1.45) * math.exp(-(((v - 0.62) / 0.26) ** 2))
                shoulder_kick = 0.010 * math.exp(-(((v - 0.88) / 0.10) ** 2))
                px = side * (lerp(x_sill, x_belt, v ** 1.35) + base_bulge - scallop_depth + shoulder_kick)
                row.append((px, y, pz))
            grid.append(row)

        build_grid_with_flange(
            f"Panel_Door_{sfx}",
            grid,
            mats["paint"],
            subsurf_levels=2,
            flange_vec_fn=lambda co, s=side: (-s * 0.009, 0.0, 0.0),
            outward_dir=(side, 0.0, 0.1),
        )

        # Gloss-Black OEM A-Pillar / Side-Window Front Corner Mirror Gusset Plate
        bm = bmesh.new()
        g_pts = [
            (side * 0.830, 0.822, 0.766),
            (side * 0.842, 0.535, 0.770),
            (side * 0.765, 0.560, 0.865),
            (side * 0.625, 0.815, 0.785),
        ]
        gv = [bm.verts.new(p) for p in g_pts]
        bm.faces.new(gv if side > 0 else tuple(reversed(gv)))
        create_mesh_obj(f"DoorMirrorGusset_{sfx}", bm, mats["gloss_black"], subsurf_levels=1, solidify_thickness=0.008, recalc_normals=False)

        # Carbon-Fiber Side-Skirt Aero Blade + Rear Shark-Fin Flick ahead of rear tire
        add_beveled_box(
            f"CarbonSideSkirt_{sfx}",
            (side * 0.972, 0.03, 0.136),
            (0.032, 0.84, 0.015),
            mats["carbon"],
            bevel_w=0.003,
        )
        add_beveled_box(
            f"SideSkirtWinglet_{sfx}",
            (side * 0.992, -0.76, 0.185),
            (0.007, 0.075, 0.052),
            mats["carbon"],
            bevel_w=0.0025,
            rot_euler=(0.0, 0.0, side * 0.08),
        )

        # Flush Satin-Titanium Door Handle
        add_beveled_box(
            f"FlushDoorHandle_{sfx}",
            (side * 0.888, -0.44, 0.748),
            (0.006, 0.068, 0.010),
            mats["rim"],
            bevel_w=0.0025,
            rot_euler=(0.0, side * 0.22, side * -0.05),
        )

        # Sculpted Subdivided Aerodynamic Wing Mirror + Twin Stalk + Reflective Mirror Glass
        add_beveled_box(
            f"MirrorStalkLower_{sfx}",
            (side * 0.915, 0.50, 0.792),
            (0.065, 0.022, 0.007),
            mats["carbon"],
            bevel_w=0.002,
            rot_euler=(0.05, side * -0.26, side * -0.22),
        )
        # Smooth teardrop mirror cap
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            lx = v.co.x * 0.165
            ly = v.co.y * (0.055 if v.co.x * side < 0 else 0.038)
            lz = v.co.z * (0.052 if v.co.y < 0 else 0.036)
            # Aerodynamic sweep rearward
            ly -= abs(v.co.x) * 0.028
            v.co = (side * 1.005 + lx, 0.475 + ly, 0.828 + lz)
        create_mesh_obj(f"MirrorHousing_{sfx}", bm, mats["paint"], subsurf_levels=2)

        # Reflective Mirror Glass Face (facing rearward -Y)
        add_beveled_box(
            f"MirrorGlassFace_{sfx}",
            (side * 1.008, 0.442, 0.828),
            (0.064, 0.004, 0.020),
            mats["mirror"],
            bevel_w=0.001,
            rot_euler=(0.0, 0.0, side * -0.12),
        )


def build_widebody_rear_quarters_and_intakes(mats):
    """
    Radial-to-Perimeter Pure-Quad Lofted Widebody Rear Quarters (`SUBSURF levels=2`)
    with natural scooped Mid-Engine Side Air Intakes and exposed lower rear tire stance.
    """
    th_front = -0.52           # front-bottom of rear arch (y ~ -1.00, z ~ 0.16)
    th_rear = math.pi + 0.30   # rear-lower of rear arch (y ~ -1.72, z ~ 0.25 -> exposes wide 325mm rear tires!)
    n_ang = 17

    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        s_rings = [[] for _ in range(6)]

        for k in range(n_ang):
            u = k / (n_ang - 1.0)  # 0.0 (front-bottom) -> 0.5 (top of 21" wheel) -> 1.0 (rear-lower)
            th = lerp(th_front, th_rear, u)
            ay = AXLE_REAR_Y + ARCH_REAR_R * math.cos(th)
            az = max(0.150, WHEEL_REAR_R + ARCH_REAR_R * math.sin(th))
            ax_lip = side * 1.018

            flare_r = ARCH_REAR_R + 0.030
            fy = AXLE_REAR_Y + flare_r * math.cos(th)
            fz = max(0.155, WHEEL_REAR_R + flare_r * math.sin(th))
            fx = side * (1.024 - 0.010 * (math.sin(th) ** 2))

            # Outer perimeter P_outer(u):
            # u in [0.00..0.26]: sweeps UP the leading edge of the Rear Quarter (forming the wide Side Intake scoop!)
            # u in [0.26..0.76]: sweeps REARWARD along Rear-Deck / Engine-Bay upper seam
            # u in [0.76..1.00]: wraps smoothly around sculpted Kammback tail corner down to z=0.255
            if u <= 0.26:
                tu = u / 0.26
                oy = lerp(-0.752, -0.742, tu)
                oz = lerp(0.156, catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, -0.742), smoothstep(0.0, 1.0, tu))
                # Leading edge flares outward around the intake scoop mouth (z=0.35..0.74)
                scoop_flare = 0.045 * math.exp(-(((tu - 0.58) / 0.24) ** 2))
                ox = side * (lerp(0.975, catmull_rom_1d(REAR_DECK_SEAM_X_PTS, -0.742) + 0.0025, tu ** 2.6) + scoop_flare)
            elif u <= 0.76:
                tu = (u - 0.26) / 0.50
                oy = lerp(-0.742, -2.165, tu)
                oz = catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, oy)
                ox = side * (catmull_rom_1d(REAR_DECK_SEAM_X_PTS, oy) + 0.0025)
            else:
                tu = (u - 0.76) / 0.24
                ox_abs = lerp(catmull_rom_1d(REAR_DECK_SEAM_X_PTS, -2.165) + 0.0025, 0.895, smoothstep(0.0, 0.55, tu))
                oy = lerp(tail_curve_y(ox_abs), -1.860, smoothstep(0.45, 1.0, tu))
                oz = lerp(catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, -2.165), 0.255, smoothstep(0.0, 1.0, tu))
                ox = side * ox_abs

            # Voluptuous widebody rear haunch shoulder between wheel flare and upper decklid!
            mid_y = lerp(fy, oy, 0.48)
            haunch_x = catmull_rom_1d(REAR_HAUNCH_X_PTS, clamp(mid_y, -2.20, -0.75))
            haunch_z = catmull_rom_1d(REAR_HAUNCH_CREST_Z_PTS, clamp(mid_y, -2.20, -0.75))
            top_weight = math.sin(clamp((u - 0.14) / 0.72, 0.0, 1.0) * math.pi)
            mid_x = side * lerp(lerp(abs(fx), abs(ox), 0.42), haunch_x * 0.96, top_weight * 0.75)
            mid_z = lerp(lerp(fz, oz, 0.46), haunch_z, top_weight * 0.78)

            p0 = (ax_lip - side * 0.028, ay, az)
            p1 = (ax_lip, ay, az)
            p2 = (fx, fy, fz)
            p3 = (mid_x, mid_y, mid_z)
            p4 = (lerp(mid_x, ox, 0.72), lerp(mid_y, oy, 0.72), lerp(mid_z, oz, 0.76))
            p5 = (ox, oy, oz)

            for idx, pt in enumerate((p0, p1, p2, p3, p4, p5)):
                s_rings[idx].append(pt)

        build_grid_with_flange(
            f"Panel_RearQuarter_{sfx}",
            s_rings,
            mats["paint"],
            subsurf_levels=2,
            flange_vec_fn=lambda co, s=side: (-s * 0.008, 0.0, -0.006),
            outward_dir=(side, -0.1, 0.4),
        )

        # Integrated Mid-Engine Side Air Intake Throat (dark honeycomb mesh + sleek carbon C-lip + 1 horizontal vane)
        bm = bmesh.new()
        th_z = [0.34, 0.48, 0.62, 0.76]
        th_x = [0.76, 0.94]
        tv = [[bm.verts.new((side * tx, -0.765, tz)) for tx in th_x] for tz in th_z]
        for iz in range(len(th_z) - 1):
            q = (tv[iz][0], tv[iz][1], tv[iz + 1][1], tv[iz + 1][0])
            bm.faces.new(q if side > 0 else tuple(reversed(q)))
        create_mesh_obj(f"SideIntakeMesh_{sfx}", bm, mats["grille"], subsurf_levels=0, solidify_thickness=0.006, recalc_normals=False)

        # Sleek swept carbon intake leading blade following the rear fender curve (NOT a thick grey brick!)
        bm = bmesh.new()
        lip_pts = [
            (side * 0.895, -0.745, 0.355),
            (side * 0.955, -0.735, 0.475),
            (side * 0.962, -0.735, 0.615),
            (side * 0.885, -0.745, 0.748),
        ]
        l_rings = []
        for (lx, ly, lz) in lip_pts:
            l_rings.append([
                bm.verts.new((lx - side * 0.018, ly + 0.012, lz)),
                bm.verts.new((lx + side * 0.006, ly + 0.012, lz)),
                bm.verts.new((lx + side * 0.008, ly - 0.045, lz)),
                bm.verts.new((lx - side * 0.018, ly - 0.045, lz)),
            ])
        for i in range(len(l_rings) - 1):
            r0, r1 = l_rings[i], l_rings[i + 1]
            for j in range(4):
                jn = (j + 1) % 4
                bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
        bm.faces.new(tuple(reversed(l_rings[0])))
        bm.faces.new(tuple(l_rings[-1]))
        create_mesh_obj(f"SideIntakeCarbonBlade_{sfx}", bm, mats["carbon"], subsurf_levels=1)

        # Single crisp horizontal aerodynamic intake splitter vane
        add_beveled_box(
            f"SideIntakeSplitterVane_{sfx}",
            (side * 0.915, -0.745, 0.555),
            (0.058, 0.048, 0.005),
            mats["carbon"],
            bevel_w=0.0018,
            rot_euler=(0.0, 0.0, side * -0.15),
        )


# ==============================================================================
# 6. CONTINUOUS TEARDROP CANOPY GLASSHOUSE, ROOF, FLYING BUTTRESSES & V12 BAY
# ==============================================================================

def build_canopy_roof_and_engine_bay(mats):
    """
    Builds one continuous, razor-smooth Catmull-Clark subdivided Teardrop Glass Canopy
    framed cleanly by Gloss-Black A-pillars, a Double-Bubble Carbon Roof, and Painted
    Flying-Buttress C-pillars, plus the sculpted painted decklid & smoked-glass V12 spine window.
    """
    canopy_stations = [
        (0.86,  0.768, 0.762, 0.52, 0.59),
        (0.62,  0.965, 0.766, 0.53, 0.78),
        (0.34,  1.118, 0.772, 0.52, 0.835),
        (0.00,  1.152, 0.786, 0.51, 0.845),
        (-0.38, 1.132, 0.802, 0.49, 0.835),
        (-0.74, 1.055, 0.820, 0.45, 0.760),
        (-1.06, 0.955, 0.855, 0.38, 0.520),
    ]

    # 1. Continuous Subdivided Teardrop Canopy Glass Dome
    ny_g = 11
    nu_g = 11
    y_g = [lerp(0.855, -1.04, i / (ny_g - 1.0)) for i in range(ny_g)]
    u_g = [lerp(-1.0, 1.0, j / (nu_g - 1.0)) for j in range(nu_g)]

    ys_ref = [s[0] for s in reversed(canopy_stations)]
    zc_ref = [s[1] for s in reversed(canopy_stations)]
    zs_ref = [s[2] for s in reversed(canopy_stations)]
    xc_ref = [s[3] for s in reversed(canopy_stations)]
    xs_ref = [s[4] for s in reversed(canopy_stations)]

    zc_pts = list(zip(ys_ref, zc_ref))
    zs_pts = list(zip(ys_ref, zs_ref))
    xc_pts = list(zip(ys_ref, xc_ref))
    xs_pts = list(zip(ys_ref, xs_ref))

    glass_grid = []
    for y in y_g:
        zc = catmull_rom_1d(zc_pts, y) - 0.005
        zs = catmull_rom_1d(zs_pts, y)
        xc = catmull_rom_1d(xc_pts, y)
        xs = catmull_rom_1d(xs_pts, y) - 0.004
        row = []
        for u in u_g:
            au = abs(u)
            sgn = -1.0 if u < 0 else (1.0 if u > 0 else 0.0)
            if au <= 0.55:
                tu = au / 0.55
                px = sgn * xc * tu
                pz = zc - 0.024 * (tu * tu)
            else:
                tu = (au - 0.55) / 0.45
                px = sgn * lerp(xc, xs, math.sin(tu * math.pi * 0.5))
                pz = lerp(zc - 0.024, zs, tu ** 1.25)
            y_wrap = y + 0.055 * (1.0 - au * au) * smoothstep(0.45, 0.855, y)
            row.append((px, y_wrap, pz))
        glass_grid.append(row)

    build_grid_with_flange(
        "HeroCanopyDome",
        glass_grid,
        mats["glass"],
        subsurf_levels=2,
        flange_vec_fn=None,
        outward_dir=(0.0, 0.2, 1.0),
    )

    # 2. Double-Bubble Carbon Roof Panel
    r_y = [lerp(-0.48, 0.34, i / 6.0) for i in range(7)]
    r_u = [lerp(-1.0, 1.0, j / 8.0) for j in range(9)]
    roof_grid = []
    for y in r_y:
        zc = catmull_rom_1d(zc_pts, y) + 0.002
        xc = catmull_rom_1d(xc_pts, y) - 0.015
        row = []
        for u in r_u:
            au = abs(u)
            px = u * xc
            bubble = 0.014 * math.sin(au * math.pi) * smoothstep(0.36, 0.15, abs(y + 0.06))
            pz = zc - 0.022 * (au * au) + bubble
            y_curve = y + 0.028 * (1.0 - au * au) * smoothstep(0.10, 0.34, y)
            row.append((px, y_curve, pz))
        roof_grid.append(row)

    build_grid_with_flange(
        "Panel_DoubleBubbleRoof",
        roof_grid,
        mats["carbon"],
        subsurf_levels=2,
        flange_vec_fn=lambda co: (0.0, 0.0, -0.008),
        outward_dir=(0.0, 0.0, 1.0),
    )

    # 3. Sleek Gloss-Black A-Pillars + Painted Roof Cantrails & Flying-Buttress C-Pillars
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        ap_grid = []
        for i in range(6):
            y = lerp(0.855, 0.30, i / 5.0)
            zc = catmull_rom_1d(zc_pts, y)
            zs = catmull_rom_1d(zs_pts, y)
            xc = catmull_rom_1d(xc_pts, y)
            xs = catmull_rom_1d(xs_pts, y)
            p_in = (side * (xc * 0.96), y + 0.01, zc - 0.018)
            p_mid = (side * lerp(xc, xs, 0.28), y, lerp(zc - 0.02, zs, 0.16) + 0.006)
            p_out = (side * lerp(xc, xs, 0.48), y - 0.01, lerp(zc - 0.02, zs, 0.32))
            ap_grid.append([p_in, p_mid, p_out])

        build_grid_with_flange(
            f"APillar_{sfx}",
            ap_grid,
            mats["gloss_black"],
            subsurf_levels=1,
            flange_vec_fn=lambda co, s=side: (-s * 0.006, 0.0, -0.006),
            outward_dir=(side * 0.6, 0.4, 0.7),
        )

        bt_y = [lerp(0.34, -1.98, i / 10.0) for i in range(11)]
        bt_grid = []
        for y in bt_y:
            if y >= -0.45:
                zc = catmull_rom_1d(zc_pts, y)
                zs = catmull_rom_1d(zs_pts, y)
                xc = catmull_rom_1d(xc_pts, y)
                xs = catmull_rom_1d(xs_pts, y)
                x_in = xc - 0.008
                z_in = zc - 0.018
                x_out = lerp(xc, xs, 0.36)
                z_out = lerp(zc - 0.02, zs, 0.22)
            else:
                tb = smoothstep(-0.45, -1.98, y)
                x_seam = catmull_rom_1d(REAR_DECK_SEAM_X_PTS, max(-2.16, y))
                z_seam = catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, max(-2.16, y))
                x_in = lerp(0.475, x_seam - 0.045, tb)
                z_in = lerp(1.105, z_seam + 0.006, tb ** 0.85)
                x_out = lerp(0.615, x_seam + 0.018, tb)
                z_out = lerp(1.045, z_seam + 0.008, tb ** 0.90)

            x_mid = 0.5 * (x_in + x_out)
            z_mid = 0.5 * (z_in + z_out) + 0.012
            bt_grid.append([
                (side * x_in, y, z_in),
                (side * x_mid, y, z_mid),
                (side * x_out, y, z_out),
            ])

        build_grid_with_flange(
            f"Panel_FlyingButtress_{sfx}",
            bt_grid,
            mats["paint"],
            subsurf_levels=1,
            flange_vec_fn=None,
            outward_dir=(side * 0.4, -0.2, 1.0),
            solidify_thickness=0.012,
        )

    add_beveled_box("WindshieldCowlTrim", (0.0, 0.845, 0.758), (0.56, 0.042, 0.010), mats["gloss_black"], bevel_w=0.003)
    for wx, wy, wz, rz in ((-0.18, 0.85, 0.772, 0.08), (0.20, 0.84, 0.772, 0.11)):
        add_beveled_box("AeroWiperBlade", (wx, wy, wz), (0.22, 0.008, 0.005), mats["gloss_black"], bevel_w=0.0015, rot_euler=(0.24, 0.0, rz))

    # 4. Sculpted Painted Engine Decklid Shoulders + Narrow Jewel Smoked-Glass V12 Spine Window
    eb_y = [lerp(-2.15, -0.62, i / 7.0) for i in range(8)]
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        ed_grid = []
        for y in eb_y:
            w_out = catmull_rom_1d(REAR_DECK_SEAM_X_PTS, max(-2.18, min(-0.74, y))) - 0.003
            w_in = 0.245
            z_s = catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, max(-2.18, min(-0.74, y)))
            ed_grid.append([
                (side * w_in, y, z_s - 0.014),
                (side * lerp(w_in, w_out, 0.5), y, z_s - 0.004),
                (side * w_out, y, z_s),
            ])
        build_grid_with_flange(
            f"Panel_EngineDeckSide_{sfx}",
            ed_grid,
            mats["paint"],
            subsurf_levels=2,
            flange_vec_fn=lambda co: (0.0, 0.0, -0.008),
            outward_dir=(0.0, -0.2, 1.0),
        )

    eb_u = [lerp(-1.0, 1.0, j / 6.0) for j in range(7)]
    deck_grid = []
    for y in eb_y:
        w = 0.242
        z_s = catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, max(-2.18, min(-0.74, y))) - 0.014
        row = []
        for u in eb_u:
            au = abs(u)
            pz = z_s - 0.008 * (1.0 - au * au)
            row.append((u * w, y, pz))
        deck_grid.append(row)

    build_grid_with_flange(
        "MidEngineSmokedGlass",
        deck_grid,
        mats["glass"],
        subsurf_levels=1,
        flange_vec_fn=None,
        outward_dir=(0.0, -0.2, 1.0),
    )

    # 5 Recessed Dark-Carbon Heat-Extractor Louvers flanking the central V12 glass window
    for i in range(5):
        ly = -0.82 - i * 0.23
        lz = catmull_rom_1d(REAR_DECK_SEAM_Z_PTS, ly) - 0.002
        for side in (-1.0, 1.0):
            add_beveled_box(
                f"EngineBayLouver_{'L' if side < 0 else 'R'}_{i}",
                (side * 0.36, ly, lz),
                (0.085, 0.024, 0.004),
                mats["carbon"],
                bevel_w=0.0015,
                rot_euler=(-0.11, 0.0, side * 0.16),
            )

    # Visible V12 Twin-Plenum Intake Manifold + Crimson Cam Covers + Titanium X-Brace beneath smoked glass!
    for side in (-1.0, 1.0):
        add_beveled_box(
            f"V12Plenum_{'L' if side < 0 else 'R'}",
            (side * 0.145, -1.28, 0.755),
            (0.068, 0.34, 0.038),
            mats["rim"],
            bevel_w=0.008,
            rot_euler=(-0.10, side * 0.14, 0.0),
        )
        add_beveled_box(
            f"V12CrimsonCover_{'L' if side < 0 else 'R'}",
            (side * 0.235, -1.28, 0.735),
            (0.032, 0.32, 0.022),
            mats["caliper"],
            bevel_w=0.005,
            rot_euler=(-0.10, side * 0.18, 0.0),
        )
    for rz in (-0.54, 0.54):
        add_beveled_box("EngineStrutXBrace", (0.0, -1.28, 0.795), (0.38, 0.012, 0.007), mats["rim"], bevel_w=0.002, rot_euler=(-0.10, 0.0, rz))


# ==============================================================================
# 7. SCULPTED KAMMBACK REAR FASCIA, 3D TAILLIGHTS, HIGH EXHAUSTS, DIFFUSER & GT WING
# ==============================================================================

def build_exotic_rear_end_and_gt_wing(mats):
    """
    The CHASE & ACTION Cam Hero View:
      - Curved Kammback painted ducktail overhang
      - Deeply sculpted concave rear fascia cove with left/right hex-mesh heat extractors
      - Curved 3D Ruby Horizon Light-Blade + Outboard Twin-Slash LED Boomerangs + Amber Signals
      - High-Mounted Twin Burnt-Titanium Exhaust Canons (aligned with Nitro shock-diamond flames!)
      - Dark Curved 6-Strake Carbon Venturi Diffuser (narrowed to |x|<=0.74 so wide 325mm rear tires show!)
      - Top-Mounted Swan-Neck 3D Cambered Carbon GT Wing
    """
    # 1. Curved Kammback Painted Ducktail Upper Overhang (bridges rear quarters at z ~ 0.755)
    dk_u = [lerp(-1.0, 1.0, j / 14.0) for j in range(15)]
    dk_grid = []
    for iv, vt in enumerate((0.0, 0.55, 1.0)):  # front (-2.16) -> trailing Kammback lip (tail_curve_y)
        row = []
        for u in dk_u:
            px = u * 0.890
            y_lip = tail_curve_y(abs(px))
            py = lerp(-2.14, y_lip, vt)
            # Subtle central ducktail kick (+18mm)
            kick = 0.018 * (1.0 - u * u) * vt
            pz = lerp(0.752, 0.748, vt) + kick
            row.append((px, py, pz))
        dk_grid.append(row)

    build_grid_with_flange(
        "Panel_RearDucktailLip",
        dk_grid,
        mats["paint"],
        subsurf_levels=1,
        flange_vec_fn=None,
        outward_dir=(0.0, -0.2, 1.0),
        solidify_thickness=0.008,
    )

    # 2. Concave Rear Fascia Cove + Hex-Grille Heat Extractors (z = 0.34 .. 0.74)
    cv_u = [lerp(-1.0, 1.0, j / 12.0) for j in range(13)]
    cv_z = [0.33, 0.46, 0.60, 0.742]
    cove_grid = []
    for pz in cv_z:
        row = []
        for u in cv_u:
            px = u * lerp(0.75, 0.885, smoothstep(0.33, 0.74, pz))
            y_lip = tail_curve_y(abs(px))
            # Recessed 68mm forward in the middle of the cove for rich 3D depth!
            cove_depth = 0.068 * math.sin(smoothstep(0.33, 0.742, pz) * math.pi)
            row.append((px, y_lip + cove_depth + 0.018, pz))
        cove_grid.append(row)

    build_grid_with_flange(
        "RearConcaveFasciaCove",
        cove_grid,
        mats["gloss_black"],
        subsurf_levels=1,
        flange_vec_fn=None,
        outward_dir=(0.0, -1.0, 0.0),
        solidify_thickness=0.006,
    )

    # Left & Right Recessed Hexagonal Mesh Heat-Extractor Panels flanking the high-mount exhausts
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        add_beveled_box(
            f"RearGrillePanel_{sfx}",
            (side * 0.62, tail_curve_y(0.62) + 0.062, 0.48),
            (0.18, 0.008, 0.085),
            mats["grille"],
            bevel_w=0.003,
            rot_euler=(0.0, 0.0, side * 0.16),
        )

    # 3. Curved 3D Signature Ruby Horizon LED Light-Blade + Outboard Twin-Slash Blades
    bm = bmesh.new()
    hb_u = [lerp(-0.875, 0.875, j / 24.0) for j in range(25)]
    hb_rings = []
    for px in hb_u:
        py = tail_curve_y(abs(px)) + 0.012
        pz = 0.718 + 0.010 * (1.0 - (px / 0.88) ** 2)
        h = 0.0065
        d = 0.012
        hb_rings.append([
            bm.verts.new((px, py + d, pz - h)),
            bm.verts.new((px, py - d * 0.3, pz - h * 0.7)),
            bm.verts.new((px, py - d * 0.3, pz + h * 0.7)),
            bm.verts.new((px, py + d, pz + h)),
        ])
    for i in range(len(hb_rings) - 1):
        r0, r1 = hb_rings[i], hb_rings[i + 1]
        for j in range(4):
            jn = (j + 1) % 4
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
    bm.faces.new(tuple(reversed(hb_rings[0])))
    bm.faces.new(tuple(hb_rings[-1]))
    create_mesh_obj("TaillightHorizonBlade", bm, mats["brakelight"], subsurf_levels=1)

    # Outboard Sculpted Twin-Slash Crimson Blades + Sequential Amber Turn-Signal Ticks
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        for b_idx, z_off in enumerate((0.684, 0.654)):
            bm = bmesh.new()
            b_xs = [side * lerp(0.54 + b_idx * 0.04, 0.865, k / 6.0) for k in range(7)]
            b_rings = []
            for bx in b_xs:
                by = tail_curve_y(abs(bx)) + 0.016
                bz = z_off - 0.012 * ((abs(bx) - 0.54) / 0.33)
                b_rings.append([
                    bm.verts.new((bx, by + 0.012, bz - 0.0055)),
                    bm.verts.new((bx, by - 0.004, bz - 0.0045)),
                    bm.verts.new((bx, by - 0.004, bz + 0.0045)),
                    bm.verts.new((bx, by + 0.012, bz + 0.0055)),
                ])
            for i in range(len(b_rings) - 1):
                r0, r1 = b_rings[i], b_rings[i + 1]
                for j in range(4):
                    jn = (j + 1) % 4
                    bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
            bm.faces.new(tuple(reversed(b_rings[0])))
            bm.faces.new(tuple(b_rings[-1]))
            create_mesh_obj(f"TaillightChevron_{sfx}_{b_idx}", bm, mats["brakelight"], subsurf_levels=1)

        # Amber sequential turn-signal blade
        add_beveled_box(
            f"RearSignalTick_{sfx}",
            (side * 0.805, tail_curve_y(0.805) + 0.018, 0.625),
            (0.055, 0.008, 0.0045),
            mats["signal"],
            bevel_w=0.0015,
            rot_euler=(0.0, 0.0, side * 0.18),
        )

    # Central Low F1 Wet-Weather Rain Brake Lamp nestled in center of Venturi diffuser
    add_beveled_box("F1RainBrakeLight", (0.0, -2.185, 0.228), (0.044, 0.012, 0.015), mats["brakelight"], bevel_w=0.003)
    add_beveled_box("F1RainBrakeShroud", (0.0, -2.180, 0.228), (0.054, 0.018, 0.022), mats["carbon"], bevel_w=0.003)

    # 4. High-Mounted Twin Burnt-Titanium Exhaust Canons (x = +-0.36, y = -2.18, z = 0.46)
    #    Aligned directly with PlayerVehicle.ts supersonic Nitro plasma shock-diamond plumes!
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        ex_x = side * 0.36
        ex_y = tail_curve_y(0.36) + 0.032  # ~ -2.168
        ex_z = 0.460

        # Hollow Annular Carbon-Fiber Exhaust Surround Bezel (NO solid cap blocking the pipe!)
        bm = bmesh.new()
        bez_prof = [
            (0.045, 0.076),
            (-0.005, 0.073),
            (-0.005, 0.063),
            (0.045, 0.063),
        ]
        bez_rings = []
        for i in range(28):
            ang = (2.0 * math.pi * i) / 28.0
            cx, cz = math.cos(ang), math.sin(ang)
            bez_rings.append([bm.verts.new((ex_x + pr * cx, ex_y + py, ex_z + pr * cz)) for (py, pr) in bez_prof])
        for i in range(28):
            r0, r1 = bez_rings[i], bez_rings[(i + 1) % 28]
            for j in range(len(bez_prof)):
                jn = (j + 1) % len(bez_prof)
                bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
        create_mesh_obj(f"ExhaustCarbonBezel_{sfx}", bm, mats["carbon"], subsurf_levels=0)

        # Dual-wall slash-cut Titanium Exhaust Outer Barrel + Rolled Lip (only outer barrel & lip are shiny titanium!)
        bm = bmesh.new()
        prof = [
            (0.055, 0.062),
            (-0.046, 0.062),
            (-0.052, 0.055),
            (-0.044, 0.0515),
        ]
        rings = []
        for i in range(32):
            ang = (2.0 * math.pi * i) / 32.0
            cx, cz = math.cos(ang), math.sin(ang)
            rings.append([bm.verts.new((ex_x + pr * cx, ex_y + py - 0.010 * cz, ex_z + pr * cz)) for (py, pr) in prof])
        for i in range(32):
            r0, r1 = rings[i], rings[(i + 1) % 32]
            for j in range(len(prof) - 1):
                bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
        create_mesh_obj(f"TitaniumExhaustCanon_{sfx}", bm, mats["exhaust"], subsurf_levels=0)

        # Soot-blackened inner exhaust bore tube + deep rear baffle (reads pitch-black hollow from ALL 3/4 angles!)
        bm = bmesh.new()
        bore_prof = [
            (-0.044, 0.0515),
            (0.045, 0.0515),
            (0.045, 0.002),
        ]
        b_rings = []
        for i in range(28):
            ang = (2.0 * math.pi * i) / 28.0
            cx, cz = math.cos(ang), math.sin(ang)
            b_rings.append([bm.verts.new((ex_x + pr * cx, ex_y + py - 0.010 * cz, ex_z + pr * cz)) for (py, pr) in bore_prof])
        for i in range(28):
            r0, r1 = b_rings[i], b_rings[(i + 1) % 28]
            for j in range(len(bore_prof) - 1):
                bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
        create_mesh_obj(f"ExhaustInnerBore_{sfx}", bm, mats["tub"], subsurf_levels=0)

    # 5. Curved Dark-Carbon 6-Strake Venturi Diffuser (|x| <= 0.73 so 325mm rear tires are visible on both sides!)
    df_u = [lerp(-1.0, 1.0, j / 14.0) for j in range(15)]
    df_t = [0.0, 0.45, 0.82, 1.0]  # forward underbody (-1.75) -> rear exit (-2.19)
    diff_grid = []
    for t in df_t:
        row = []
        for u in df_u:
            au = abs(u)
            px = u * 0.725
            py = lerp(-1.74, tail_curve_y(abs(px)) + 0.025, t)
            # Twin Venturi tunnels rising aggressively at rear exit (z=0.135 -> 0.305)
            tunnel_arch = 0.038 * math.sin(clamp((au - 0.08) / 0.85, 0.0, 1.0) * math.pi) * t
            pz = lerp(0.135, 0.285, t ** 1.35) + tunnel_arch
            row.append((px, py, pz))
        diff_grid.append(row)

    build_grid_with_flange(
        "RearCarbonVenturiDiffuser",
        diff_grid,
        mats["carbon"],
        subsurf_levels=1,
        flange_vec_fn=None,
        outward_dir=(0.0, -0.5, -1.0),
        solidify_thickness=0.008,
    )

    # 6 Razor-Sharp Sculpted Vertical Venturi Diffuser Strakes
    for sx in (-0.71, -0.44, -0.16, 0.16, 0.44, 0.71):
        bm = bmesh.new()
        pts_s = [
            (-1.82, 0.135, 0.155),
            (-2.02, 0.145, 0.235),
            (-2.185, 0.165, 0.295),
            (-2.145, 0.235, 0.305),
        ]
        hw = 0.0055
        s_rings = []
        for (sy, sz0, sz1) in pts_s:
            s_rings.append([
                bm.verts.new((sx - hw, sy, sz0)),
                bm.verts.new((sx + hw, sy, sz0)),
                bm.verts.new((sx + hw, sy, sz1)),
                bm.verts.new((sx - hw, sy, sz1)),
            ])
        for i in range(len(s_rings) - 1):
            r0, r1 = s_rings[i], s_rings[i + 1]
            for j in range(4):
                jn = (j + 1) % 4
                bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
        bm.faces.new(tuple(reversed(s_rings[0])))
        bm.faces.new(tuple(s_rings[-1]))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.0018, segments=1, affect='EDGES')
        create_mesh_obj(f"VenturiStrake_{sx:+.2f}", bm, mats["carbon"], subsurf_levels=0)

    # 6. Sleek Top-Mounted Swan-Neck 3D Gull-Camber Carbon GT Wing
    wg_u = [lerp(-1.0, 1.0, j / 16.0) for j in range(17)]
    # True closed airfoil profile around wing chord (t from 0..1 around top & bottom of NACA cambered foil)
    bm = bmesh.new()
    foil_pts = [
        (0.00,  0.000),   # leading edge
        (0.22,  0.015),   # upper camber peak
        (0.60,  0.012),
        (1.00,  0.005),   # crisp Gurney trailing edge top
        (1.00,  0.001),   # trailing edge bottom
        (0.60, -0.005),   # high-downforce under-camber suction surface
        (0.22, -0.008),
    ]
    w_rings = []
    for u in wg_u:
        au = abs(u)
        px = u * 0.845
        y_le = -1.935 - 0.085 * (au ** 1.6)
        chord = lerp(0.255, 0.205, au ** 1.4)
        # Subtle GT3 gull-wing 3D contour + 7-degree downforce angle of attack
        z_base = 0.908 + 0.018 * (au ** 1.5) - 0.010 * math.exp(-((u / 0.25) ** 2))
        aoa = 0.12
        ring = []
        for (fc, ft) in foil_pts:
            ly = -fc * chord
            lz = ft + fc * chord * math.sin(aoa)
            ring.append(bm.verts.new((px, y_le + ly, z_base + lz)))
        w_rings.append(ring)

    nf = len(foil_pts)
    for i in range(len(w_rings) - 1):
        r0, r1 = w_rings[i], w_rings[i + 1]
        for j in range(nf):
            jn = (j + 1) % nf
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
    bm.faces.new(tuple(reversed(w_rings[0])))
    bm.faces.new(tuple(w_rings[-1]))
    create_mesh_obj("ActiveCarbonGTWing", bm, mats["carbon"], subsurf_levels=1)

    # Sleek Swept Carbon Endplates + Top-Mounted Swan-Neck Pylons
    for side in (-1.0, 1.0):
        sfx = "L" if side < 0 else "R"
        # Thin sculpted swept endplate (4.5mm half-thickness -> sleek motorsport blade, NOT a brick!)
        bm = bmesh.new()
        ep_quad = [
            (-1.98, 0.960),
            (-2.23, 0.972),
            (-2.26, 0.875),
            (-2.05, 0.865),
        ]
        ex = side * 0.848
        v_in = [bm.verts.new((ex - 0.004, ey, ez)) for (ey, ez) in ep_quad]
        v_out = [bm.verts.new((ex + 0.004, ey, ez)) for (ey, ez) in ep_quad]
        bm.faces.new(tuple(reversed(v_in)))
        bm.faces.new(tuple(v_out))
        for j in range(4):
            jn = (j + 1) % 4
            bm.faces.new((v_in[j], v_in[jn], v_out[jn], v_out[j]))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.0018, segments=1, affect='EDGES')
        create_mesh_obj(f"WingEndplate_{sfx}", bm, mats["carbon"], subsurf_levels=1)

        # Swan-neck pylon arcing smoothly from rear deck (-1.78, z=0.80) UP and OVER the wing leading edge!
        bm = bmesh.new()
        swan_pts = [
            (-1.76, 0.795, 0.048),
            (-1.84, 0.885, 0.036),
            (-1.92, 0.942, 0.032),
            (-2.01, 0.935, 0.038),
            (-2.05, 0.916, 0.042),
        ]
        px = side * 0.31
        p_rings = []
        for (sy, sz, chord_w) in swan_pts:
            p_rings.append([
                bm.verts.new((px - 0.006, sy + chord_w * 0.5, sz)),
                bm.verts.new((px + 0.006, sy + chord_w * 0.5, sz)),
                bm.verts.new((px + 0.006, sy - chord_w * 0.5, sz - 0.016)),
                bm.verts.new((px - 0.006, sy - chord_w * 0.5, sz - 0.016)),
            ])
        for i in range(len(p_rings) - 1):
            r0, r1 = p_rings[i], p_rings[i + 1]
            for j in range(4):
                jn = (j + 1) % 4
                bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
        bm.faces.new(tuple(reversed(p_rings[0])))
        bm.faces.new(tuple(p_rings[-1]))
        create_mesh_obj(f"SwanNeckPylon_{sfx}", bm, mats["carbon"], subsurf_levels=1)


# ==============================================================================
# 8. COCKPIT INTERIOR & LIVE ARTICULATED STEERING WHEEL
# ==============================================================================

def build_cockpit_interior(mats):
    """Cockpit dashboard binnacle, digital OLED gauge glow, bucket seats & live steering wheel."""
    add_beveled_box("InteriorFloorTub", (0.0, 0.08, 0.24), (0.66, 0.68, 0.03), mats["cockpit"], bevel_w=0.008)
    add_beveled_box("InteriorRearBulkhead", (0.0, -0.54, 0.60), (0.64, 0.05, 0.34), mats["cockpit"], bevel_w=0.012, rot_euler=(0.14, 0.0, 0.0))
    add_beveled_box("InteriorDashboard", (0.0, 0.58, 0.69), (0.64, 0.20, 0.085), mats["cockpit"], bevel_w=0.022)
    add_beveled_box("DriverGaugeBinnacle", (-0.32, 0.50, 0.775), (0.155, 0.10, 0.045), mats["cockpit"], bevel_w=0.014)
    add_beveled_box("DigitalGaugeCluster", (-0.32, 0.41, 0.772), (0.125, 0.006, 0.032), mats["gauge"], bevel_w=0.002, rot_euler=(-0.22, 0.0, 0.0))
    add_beveled_box("CenterConsoleSpine", (0.0, 0.12, 0.45), (0.09, 0.48, 0.10), mats["carbon"], bevel_w=0.012, rot_euler=(-0.12, 0.0, 0.0))

    for sx in (-0.32, 0.32):
        sfx = "L" if sx < 0 else "R"
        add_beveled_box(f"SeatCushion_{sfx}", (sx, -0.08, 0.34), (0.20, 0.23, 0.05), mats["cockpit"], bevel_w=0.015, rot_euler=(-0.08, 0.0, 0.0))
        add_beveled_box(f"SeatBackrest_{sfx}", (sx, -0.32, 0.64), (0.19, 0.055, 0.28), mats["cockpit"], bevel_w=0.020, rot_euler=(-0.28, 0.0, 0.0))
        add_beveled_box(f"SeatHeadrestAccent_{sfx}", (sx, -0.40, 0.87), (0.11, 0.042, 0.085), mats["seat_accent"], bevel_w=0.015, rot_euler=(-0.22, 0.0, 0.0))

    # Articulated Steering Wheel ('InteriorSteeringCylinder' rotates cleanly around local Z in Three.js!)
    col_mount = bpy.data.objects.new("SteeringColumnMount", None)
    col_mount.location = (-0.32, 0.31, 0.725)
    col_mount.rotation_euler = (-1.22, 0.0, 0.0)
    bpy.context.collection.objects.link(col_mount)

    bm = bmesh.new()
    segs = 32
    R_maj = 0.150
    r_min = 0.016
    t_rings = []
    for i in range(segs):
        ang = (2.0 * math.pi * i) / segs
        cx = R_maj * math.cos(ang)
        cy = R_maj * math.sin(ang)
        if cy < -R_maj * 0.68:
            cy = -R_maj * 0.68  # flat-bottom GT3 race wheel!
        radial = mathutils.Vector((math.cos(ang), math.sin(ang), 0.0))
        ring = []
        for j in range(10):
            ba = (2.0 * math.pi * j) / 10.0
            off = radial * (r_min * math.cos(ba)) + mathutils.Vector((0.0, 0.0, r_min * math.sin(ba)))
            ring.append(bm.verts.new(mathutils.Vector((cx, cy, 0.0)) + off))
        t_rings.append(ring)

    for i in range(segs):
        r0, r1 = t_rings[i], t_rings[(i + 1) % segs]
        for j in range(10):
            jn = (j + 1) % 10
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))

    hub = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=0.052, radius2=0.046, depth=0.038)
    for sp_ang in (0.0, math.pi, -math.pi * 0.5):
        sp = bmesh.ops.create_cube(bm, size=1.0)
        for v in sp["verts"]:
            v.co.x = (v.co.x + 0.5) * 0.13
            v.co.y *= 0.022
            v.co.z *= 0.012
        bmesh.ops.rotate(bm, verts=sp["verts"], matrix=mathutils.Matrix.Rotation(sp_ang, 3, 'Z'))

    sw_obj = create_mesh_obj("InteriorSteeringCylinder", bm, mats["cockpit"], subsurf_levels=0)
    sw_obj.parent = col_mount


# ==============================================================================
# 9. STAGGERED 20"/21" FORGED 5-TWIN-Y-SPOKE WHEELS, WET TIRES, ROTORS & CALIPERS
# ==============================================================================

def create_forged_wheel_assembly(name, radius, width, is_left, is_front, mats):
    """
    Hierarchical Wheel Rig compatible with PlayerVehicle.ts:
      <name> (Empty knuckle at axle center — front steers on Y)
        ├── <name>_Tire         (spins on X)
        ├── <name>_Rim          (spins on X)
        ├── <name>_CenterLock   (spins on X)
        ├── <name>_Disc         (spins on X; 'Disc' glows orange-red under heavy braking)
        └── <name>_BrakePad     (6-piston crimson monoblock caliper; does NOT spin!)
    """
    knuckle = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(knuckle)

    hw = width * 0.5
    rim_r = radius * (0.748 if is_front else 0.758)
    out_sign = -1.0 if is_left else 1.0

    # 1. Grooved Wet-Weather UHP Tire with Rounded Michelin-Style Sidewall & Rim Protector Rib
    bm = bmesh.new()
    segs = 36
    prof = [
        (-hw * 0.84, rim_r * 0.99),
        (-hw * 0.97, rim_r + (radius - rim_r) * 0.35),
        (-hw * 0.995, rim_r + (radius - rim_r) * 0.68),
        (-hw * 0.92, radius * 0.985),
        (-hw * 0.70, radius),
        (-hw * 0.44, radius),
        (-hw * 0.41, radius - 0.007),  # outer rain channel
        (-hw * 0.34, radius - 0.007),
        (-hw * 0.31, radius),
        (-hw * 0.06, radius),
        (-hw * 0.03, radius - 0.008),  # center rain channel
        (hw * 0.03, radius - 0.008),
        (hw * 0.06, radius),
        (hw * 0.31, radius),
        (hw * 0.34, radius - 0.007),   # inner rain channel
        (hw * 0.41, radius - 0.007),
        (hw * 0.44, radius),
        (hw * 0.70, radius),
        (hw * 0.92, radius * 0.985),
        (hw * 0.995, rim_r + (radius - rim_r) * 0.68),
        (hw * 0.97, rim_r + (radius - rim_r) * 0.35),
        (hw * 0.84, rim_r * 0.99),
    ]
    rings = []
    for i in range(segs):
        ang = (2.0 * math.pi * i) / segs
        cy, cz = math.cos(ang), math.sin(ang)
        rings.append([bm.verts.new((px, pr * cy, pr * cz)) for (px, pr) in prof])
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for j in range(len(prof) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    tire_obj = create_mesh_obj(name + "_Tire", bm, mats["tire"], subsurf_levels=0)
    tire_obj.parent = knuckle

    # 2. Deep-Concave 5-Twin-Y-Spoke Machined Forged Alloy Rim
    bm = bmesh.new()
    barrel_prof = [
        (out_sign * hw * 0.87, rim_r * 1.008),
        (out_sign * hw * 0.89, rim_r * 0.962),
        (out_sign * hw * 0.74, rim_r * 0.942),
        (-out_sign * hw * 0.78, rim_r * 0.920),
        (-out_sign * hw * 0.78, rim_r * 0.882),
        (out_sign * hw * 0.76, rim_r * 0.902),
        (out_sign * hw * 0.87, rim_r * 0.952),
    ]
    b_rings = []
    for i in range(36):
        ang = (2.0 * math.pi * i) / 36.0
        cy, cz = math.cos(ang), math.sin(ang)
        b_rings.append([bm.verts.new((px, pr * cy, pr * cz)) for (px, pr) in barrel_prof])
    for i in range(36):
        r0, r1 = b_rings[i], b_rings[(i + 1) % 36]
        for j in range(len(barrel_prof) - 1):
            q = (r0[j], r1[j], r1[j + 1], r0[j + 1])
            bm.faces.new(q if out_sign > 0 else tuple(reversed(q)))

    hub_x = out_sign * (hw * 0.48 if is_front else hw * 0.36)  # deeper concave dish on 21" rears!
    lip_x = out_sign * hw * 0.84
    hub = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=25, radius1=rim_r * 0.26, radius2=rim_r * 0.23, depth=0.055)
    bmesh.ops.rotate(bm, verts=hub["verts"], matrix=mathutils.Matrix.Rotation(math.pi * 0.5, 3, 'Y'))
    for v in hub["verts"]:
        v.co.x += hub_x

    for p_idx in range(5):
        base_ang = (2.0 * math.pi * p_idx) / 5.0
        stem = bmesh.ops.create_cube(bm, size=1.0)
        for v in stem["verts"]:
            t_r = v.co.z + 0.5
            rad = lerp(rim_r * 0.20, rim_r * 0.47, t_r)
            w_t = lerp(0.028, 0.022, t_r)
            cx = lerp(hub_x, lerp(hub_x, lip_x, 0.42), t_r) + v.co.x * 0.020
            v.co = (cx, v.co.y * w_t, rad)
        bmesh.ops.rotate(bm, verts=stem["verts"], matrix=mathutils.Matrix.Rotation(base_ang, 3, 'X'))
        bmesh.ops.bevel(bm, geom=list({e for f in stem["verts"] for e in f.link_edges}), offset=0.0022, segments=1, affect='EDGES')

        for fork_sign in (-1.0, 1.0):
            br = bmesh.ops.create_cube(bm, size=1.0)
            for v in br["verts"]:
                t_r = v.co.z + 0.5
                rad = lerp(rim_r * 0.43, rim_r * 0.945, t_r)
                lat = fork_sign * lerp(0.008, rim_r * 0.25, t_r)
                w_t = lerp(0.018, 0.013, t_r)
                cx = lerp(lerp(hub_x, lip_x, 0.38), lip_x, t_r ** 0.82) + v.co.x * 0.018
                v.co = (cx, lat + v.co.y * w_t, rad)
            bmesh.ops.rotate(bm, verts=br["verts"], matrix=mathutils.Matrix.Rotation(base_ang, 3, 'X'))
            bmesh.ops.bevel(bm, geom=list({e for f in br["verts"] for e in f.link_edges}), offset=0.002, segments=1, affect='EDGES')

    rim_obj = create_mesh_obj(name + "_Rim", bm, mats["rim"], subsurf_levels=0)
    rim_obj.parent = knuckle

    # 3. Anodized Crimson Center-Lock Hex Nut
    bm = bmesh.new()
    cl = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6, radius1=rim_r * 0.13, radius2=rim_r * 0.10, depth=0.038)
    bmesh.ops.rotate(bm, verts=cl["verts"], matrix=mathutils.Matrix.Rotation(math.pi * 0.5, 3, 'Y'))
    for v in cl["verts"]:
        v.co.x += hub_x + out_sign * 0.025
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.003, segments=1, affect='EDGES')
    cl_obj = create_mesh_obj(name + "_CenterLock", bm, mats["caliper"], subsurf_levels=0)
    cl_obj.parent = knuckle

    # 4. Slotted / Cross-Drilled Carbon-Ceramic Brake Disc ('Disc' with circular UVs!)
    bm = bmesh.new()
    disc_r = rim_r * 0.82
    disc_x = out_sign * hw * 0.18
    disc_res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=36, radius1=disc_r, radius2=disc_r, depth=0.034)
    bmesh.ops.rotate(bm, verts=disc_res["verts"], matrix=mathutils.Matrix.Rotation(math.pi * 0.5, 3, 'Y'))
    for v in disc_res["verts"]:
        v.co.x += disc_x
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            vy = loop.vert.co.y / disc_r
            vz = loop.vert.co.z / disc_r
            loop[uv_layer].uv = (vy * 0.48 + 0.5, vz * 0.48 + 0.5)

    disc_mesh = bpy.data.meshes.new(name + "_DiscMesh")
    bm.to_mesh(disc_mesh)
    bm.free()
    for p in disc_mesh.polygons:
        p.use_smooth = True
    disc_obj = bpy.data.objects.new(name + "_Disc", disc_mesh)
    disc_obj.parent = knuckle
    disc_obj.data.materials.append(mats["disc"])
    bpy.context.collection.objects.link(disc_obj)

    # 5. Stationary 6-Piston Monoblock Crimson Brake Caliper ('<name>_BrakePad')
    bm = bmesh.new()
    cal_ang_start = -0.46 if is_front else 2.44
    cal_ang_end = 0.46 if is_front else 3.36
    c_rings = []
    for k in range(8):
        ca = lerp(cal_ang_start, cal_ang_end, k / 7.0)
        cy, cz = math.cos(ca), math.sin(ca)
        r_in = disc_r * 0.65
        r_out = disc_r * 1.07
        x0, x1 = disc_x - 0.044, disc_x + 0.044
        c_rings.append([
            bm.verts.new((x0, r_in * cy, r_in * cz)),
            bm.verts.new((x1, r_in * cy, r_in * cz)),
            bm.verts.new((x1, r_out * cy, r_out * cz)),
            bm.verts.new((x0, r_out * cy, r_out * cz)),
        ])
    for i in range(len(c_rings) - 1):
        r0, r1 = c_rings[i], c_rings[i + 1]
        for j in range(4):
            jn = (j + 1) % 4
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
    bm.faces.new(tuple(reversed(c_rings[0])))
    bm.faces.new(tuple(c_rings[-1]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.006, segments=2, affect='EDGES')
    cal_obj = create_mesh_obj(name + "_BrakePad", bm, mats["caliper"], subsurf_levels=0)
    cal_obj.parent = knuckle

    return knuckle


# ==============================================================================
# 10. METRIC TRIPLANAR UV PROJECTION, BATCHING & GLB EXPORT
# ==============================================================================

def assign_metric_triplanar_uvs(mesh, tiles_per_meter=22.0):
    """Generates clean world-metric triplanar UVs so 2x2 twill carbon weave & normal maps tile crisply."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        nx, ny, nz = abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)
        for loop in f.loops:
            co = loop.vert.co
            if nz >= nx and nz >= ny:
                u, v = co.x * tiles_per_meter, co.y * tiles_per_meter
            elif nx >= ny:
                u, v = co.y * tiles_per_meter, co.z * tiles_per_meter
            else:
                u, v = co.x * tiles_per_meter, co.z * tiles_per_meter
            loop[uv_layer].uv = (u, v)
    bm.to_mesh(mesh)
    bm.free()


def build_hero_supercar():
    print("=== Building Original Hero Supercar (Pass 2 Catmull-Clark Class-A): NIGHTSHIFT V12 GT ===")
    clear_scene()
    mats = build_materials()

    build_underbody_and_open_wheelhouses(mats)
    build_bonnet_panel(mats)
    build_front_fenders(mats)
    build_front_bumper_and_headlamps(mats)
    build_sculpted_doors_and_mirrors(mats)
    build_widebody_rear_quarters_and_intakes(mats)
    build_canopy_roof_and_engine_bay(mats)
    build_exotic_rear_end_and_gt_wing(mats)
    build_cockpit_interior(mats)

    wheel_configs = [
        ("WheelFrontL", -TRACK_FRONT_X, AXLE_FRONT_Y, WHEEL_FRONT_R, 0.265, True, True),
        ("WheelFrontR",  TRACK_FRONT_X, AXLE_FRONT_Y, WHEEL_FRONT_R, 0.265, False, True),
        ("WheelRearL",  -TRACK_REAR_X,  AXLE_REAR_Y,  WHEEL_REAR_R,  0.325, True, False),
        ("WheelRearR",   TRACK_REAR_X,  AXLE_REAR_Y,  WHEEL_REAR_R,  0.325, False, False),
    ]
    for wname, wx, wy, wr, ww, is_left, is_front in wheel_configs:
        w = create_forged_wheel_assembly(wname, wr, ww, is_left, is_front, mats)
        w.location = (wx, wy, wr)

    # Apply Subsurf modifiers on all meshes, then join static opaque vs static glass
    # while keeping animated Wheel* hierarchies and InteriorSteeringCylinder separate!
    bpy.ops.object.select_all(action='DESELECT')
    static_opaque = []
    static_glass = []

    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        for mod in list(obj.modifiers):
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)

        if obj.parent is not None:
            if not obj.name.endswith("_Disc"):
                assign_metric_triplanar_uvs(obj.data)
            continue

        mat_names = [m.name for m in obj.data.materials if m]
        if any(mn in ("Glass", "LensGlass") for mn in mat_names):
            static_glass.append(obj)
        else:
            static_opaque.append(obj)

    if len(static_opaque) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in static_opaque:
            o.select_set(True)
        bpy.context.view_layer.objects.active = static_opaque[0]
        bpy.ops.object.join()
        hero_opaque = bpy.context.view_layer.objects.active
        hero_opaque.name = "HeroChassisOpaque"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        assign_metric_triplanar_uvs(hero_opaque.data)

    if len(static_glass) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in static_glass:
            o.select_set(True)
        bpy.context.view_layer.objects.active = static_glass[0]
        bpy.ops.object.join()
        hero_glass = bpy.context.view_layer.objects.active
        hero_glass.name = "HeroCanopyGlass"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        assign_metric_triplanar_uvs(hero_glass.data)

    # Report exact vertex & triangle counts
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total_tris = 0
    total_verts = 0
    mesh_count = 0
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            eval_obj = obj.evaluated_get(depsgraph)
            m = eval_obj.to_mesh()
            m.calc_loop_triangles()
            total_tris += len(m.loop_triangles)
            total_verts += len(m.vertices)
            mesh_count += 1
            eval_obj.to_mesh_clear()

    print(f"Mesh Objects: {mesh_count} | Vertices: {total_verts:,} | Triangles: {total_tris:,}")

    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format='GLB',
        export_image_format='WEBP',
        export_image_quality=90,
        export_yup=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
    )
    size_bytes = os.path.getsize(OUT_PATH)
    print(f"Exported {OUT_PATH} ({size_bytes:,} bytes = {size_bytes / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    build_hero_supercar()
