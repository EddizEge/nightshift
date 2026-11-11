"""
NIGHTSHIFT 3D Traffic Asset Pipeline (Blender 4.3 Headless)
Generates smooth Catmull-Clark Subdivision Surface / Beveled high-detail PBR traffic vehicles (CC0):
   - public/assets/models/traffic_sedan.glb
   - public/assets/models/traffic_suv.glb
   - public/assets/models/traffic_truck.glb
   - public/assets/models/traffic_tanker.glb
(Hero player car is generated separately from scratch by scripts/build_player_car.py)
"""

import bpy
import bmesh
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "public", "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, base_color, metallic=0.0, roughness=0.4, emission=None, emission_strength=0.0, coat=0.0, coat_rough=0.05, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
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
        mat.blend_method = 'BLEND' if hasattr(mat, 'blend_method') else 'HASHED'
    return mat


def create_alloy_wheel(name, radius, width, spokes=7, mat_tire=None, mat_rim=None, mat_disc=None):
    """Creates a detailed multi-spoke alloy wheel + treaded tire + brake rotor centered at origin, axle along X."""
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)

    # 1. Tire (Torus + profiled cylinder with rounded sidewall)
    bm = bmesh.new()
    segs = 36
    # Cross-section profile of tire in X-R plane (x_off, r)
    hw = width * 0.5
    rim_r = radius * 0.66
    sh_r = radius * 0.96
    profile = [
        (-hw * 0.78, rim_r),
        (-hw * 0.98, rim_r + (radius - rim_r) * 0.42),
        (-hw * 0.94, sh_r),
        (-hw * 0.65, radius),
        (hw * 0.65, radius),
        (hw * 0.94, sh_r),
        (hw * 0.98, rim_r + (radius - rim_r) * 0.42),
        (hw * 0.78, rim_r),
    ]
    rings = []
    for i in range(segs):
        ang = (2.0 * math.pi * i) / segs
        cy, cz = math.cos(ang), math.sin(ang)
        ring = [bm.verts.new((px, pr * cy, pr * cz)) for (px, pr) in profile]
        rings.append(ring)
    for i in range(segs):
        r0 = rings[i]
        r1 = rings[(i + 1) % segs]
        for j in range(len(profile) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    tire_mesh = bpy.data.meshes.new(name + "_TireMesh")
    bm.to_mesh(tire_mesh)
    bm.free()
    for p in tire_mesh.polygons:
        p.use_smooth = True
    tire_obj = bpy.data.objects.new(name + "_Tire", tire_mesh)
    tire_obj.data.materials.append(mat_tire)
    tire_obj.parent = parent
    bpy.context.collection.objects.link(tire_obj)

    # 2. Alloy Rim Barrel + Hub + Spokes
    bm = bmesh.new()
    # Outer barrel
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=32,
        radius1=rim_r * 1.01, radius2=rim_r * 1.01, depth=width * 0.72
    )
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=math_rot_y_90())
    # Center hub cap
    hub = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=20,
        radius1=rim_r * 0.28, radius2=rim_r * 0.24, depth=width * 0.82
    )
    bmesh.ops.rotate(bm, verts=hub["verts"], matrix=math_rot_y_90())

    # Spokes on both sides so left/right mirror cleanly or outward face looks great
    for side in (-1.0, 1.0):
        for s in range(spokes):
            ang = (2.0 * math.pi * s) / spokes
            spoke = bmesh.ops.create_cube(bm, size=1.0)
            sv = spoke["verts"]
            for v in sv:
                v.co.x *= width * 0.08
                v.co.y *= rim_r * 0.09
                v.co.z *= rim_r * 0.84
                v.co.z += rim_r * 0.46
                v.co.x += side * width * 0.34
            bmesh.ops.rotate(bm, verts=sv, matrix=math_rot_x(ang))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rim_mesh = bpy.data.meshes.new(name + "_RimMesh")
    bm.to_mesh(rim_mesh)
    bm.free()
    for p in rim_mesh.polygons:
        p.use_smooth = True
    rim_obj = bpy.data.objects.new(name + "_Rim", rim_mesh)
    rim_obj.data.materials.append(mat_rim)
    rim_obj.parent = parent
    bpy.context.collection.objects.link(rim_obj)

    # 3. Inner Brake Rotor Disc
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=24,
        radius1=rim_r * 0.76, radius2=rim_r * 0.76, depth=width * 0.14
    )
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=math_rot_y_90())
    disc_mesh = bpy.data.meshes.new(name + "_DiscMesh")
    bm.to_mesh(disc_mesh)
    bm.free()
    for p in disc_mesh.polygons:
        p.use_smooth = True
    disc_obj = bpy.data.objects.new(name + "_Disc", disc_mesh)
    disc_obj.data.materials.append(mat_disc)
    disc_obj.parent = parent
    bpy.context.collection.objects.link(disc_obj)

    return parent


def math_rot_y_90():
    import mathutils
    return mathutils.Matrix.Rotation(math.pi * 0.5, 3, 'Y')


def math_rot_x(ang):
    import mathutils
    return mathutils.Matrix.Rotation(ang, 3, 'X')


def build_lofted_car_body(name, stations, subsurf_levels=2, mat_body=None, mat_glass=None, mat_trim=None, mat_headlight=None, mat_taillight=None, wheel_well_z=None):
    """
    Builds a smooth Catmull-Clark subdivided automotive body from longitudinal cross-section stations.
    Convention: Car faces +Z (front = +Z, rear = -Z), Up = +Y, Left/Right = +-X!
    Wait: Blender uses Z-up internally and glTF exporter converts +Z->+Y and +Y->-Z when export_yup=True!
    So in Blender Z-up coordinates:
      Front = -Y (in Blender, -Y exports to +Z in glTF? Wait: glTF +Y=Up, +Z=Forward/Back:
      Blender (X, Y, Z) -> glTF (X, Z, -Y)!
      So Blender -Y -> glTF +Z! And Blender +Y -> glTF -Z!
      Let's make Front = -Y in Blender so exported glTF faces +Z just like player_car.glb!
    """
    bm = bmesh.new()
    # Each station: (y_blender, bottom_z, belt_z, roof_z, half_w_bottom, half_w_belt, half_w_roof, is_glass_zone)
    rings = []
    for st in stations:
        yb, bz, wz, rz, hwb, hww, hwr, _ = st
        # 10-vertex symmetric cross section around X (from bottom center -> right -> roof -> left -> bottom)
        pts = [
            (0.0, yb, bz),
            (hwb * 0.72, yb, bz + 0.015),
            (hwb, yb, bz + (wz - bz) * 0.36),
            (hww, yb, wz),
            (hwr, yb, rz - 0.02),
            (0.0, yb, rz),
            (-hwr, yb, rz - 0.02),
            (-hww, yb, wz),
            (-hwb, yb, bz + (wz - bz) * 0.36),
            (-hwb * 0.72, yb, bz + 0.015),
        ]
        ring = [bm.verts.new(p) for p in pts]
        rings.append((ring, st[7]))

    n_prof = len(rings[0][0])
    glass_faces = []
    trim_faces = []
    for i in range(len(rings) - 1):
        r0, g0 = rings[i]
        r1, g1 = rings[i + 1]
        is_glass = g0 and g1
        for j in range(n_prof):
            jn = (j + 1) % n_prof
            f = bm.faces.new((r0[j], r0[jn], r1[jn], r1[j]))
            # Upper cabin indices: j in (3, 4, 5, 6) connect belt->roof->belt
            if is_glass and j in (3, 6):
                glass_faces.append(f)  # side windows
            elif (g0 != g1) and j in (3, 4, 5, 6):
                glass_faces.append(f)  # windshield & rear glass!
            elif j in (0, 9):
                trim_faces.append(f)  # dark underbody / rocker diffuser

    # Cap front & rear bumpers
    front_cap = bm.faces.new(list(reversed(rings[0][0])))
    rear_cap = bm.faces.new(rings[-1][0])
    trim_faces.append(front_cap)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name + "_Mesh")
    mat_list = [mat_body, mat_glass, mat_trim, mat_headlight, mat_taillight]
    for m in mat_list:
        mesh.materials.append(m)

    for f in bm.faces:
        f.smooth = True
        if f in glass_faces:
            f.material_index = 1
        elif f in trim_faces:
            f.material_index = 2
        else:
            f.material_index = 0

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    # Smooth Catmull-Clark Subdivision for genuine curved automotive surfaces
    sub = obj.modifiers.new(name="Subsurf", type='SUBSURF')
    sub.levels = subsurf_levels
    sub.render_levels = subsurf_levels
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=sub.name)

    return obj


def add_light_strip(name, loc, size, mat, bevel_w=0.018):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel_w, segments=2, affect='EDGES')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    return obj


def add_side_mirrors(prefix, y_pos, z_pos, half_w, mat_body, mat_trim):
    objs = []
    for side, sx in (("L", 1.0), ("R", -1.0)):
        housing = add_light_strip(
            f"{prefix}_Mirror{side}",
            (sx * (half_w + 0.08), y_pos, z_pos),
            (0.15, 0.11, 0.08),
            mat_body,
            bevel_w=0.022
        )
        objs.append(housing)
    return objs


def build_sedan():
    print("=== Building High-Poly Smooth Traffic Sedan (traffic_sedan.glb) ===")
    clear_scene()
    mat_body = make_pbr_mat("CarBody", (0.72, 0.75, 0.79), metallic=0.82, roughness=0.22, coat=1.0, coat_rough=0.04)
    mat_glass = make_pbr_mat("CarGlass", (0.02, 0.03, 0.045), metallic=0.1, roughness=0.05, coat=1.0, coat_rough=0.02)
    mat_trim = make_pbr_mat("CarTrim", (0.04, 0.042, 0.048), metallic=0.35, roughness=0.45)
    mat_head = make_pbr_mat("Headlight", (0.95, 0.98, 1.0), metallic=0.0, roughness=0.1, emission=(0.92, 0.96, 1.0), emission_strength=8.0)
    mat_tail = make_pbr_mat("Taillight", (0.9, 0.03, 0.03), metallic=0.0, roughness=0.12, emission=(1.0, 0.04, 0.02), emission_strength=7.5)
    mat_tire = make_pbr_mat("TireRubber", (0.035, 0.035, 0.038), metallic=0.0, roughness=0.78)
    mat_rim = make_pbr_mat("AlloyRim", (0.78, 0.80, 0.84), metallic=0.92, roughness=0.18)
    mat_disc = make_pbr_mat("BrakeDisc", (0.35, 0.36, 0.38), metallic=0.88, roughness=0.35)

    # Length 4.72m (-2.36 front to +2.36 rear), width 1.88m, height 1.43m
    stations = [
        # (y, bot_z, belt_z, roof_z, hw_bot, hw_belt, hw_roof, glass_zone)
        (-2.36, 0.24, 0.50, 0.56, 0.72, 0.76, 0.62, False),
        (-2.22, 0.19, 0.64, 0.72, 0.88, 0.91, 0.76, False),
        (-1.55, 0.18, 0.78, 0.84, 0.93, 0.95, 0.82, False),
        (-0.92, 0.17, 0.87, 0.92, 0.94, 0.95, 0.83, False),  # base of windshield
        (-0.28, 0.17, 0.91, 1.41, 0.94, 0.94, 0.70, True),   # front roof header
        (0.55,  0.17, 0.93, 1.42, 0.94, 0.94, 0.69, True),   # B/C pillar
        (1.28,  0.18, 0.95, 1.33, 0.93, 0.93, 0.66, True),   # rear glass top
        (1.78,  0.20, 0.96, 1.02, 0.92, 0.92, 0.76, False),  # trunk deck
        (2.26,  0.24, 0.88, 0.97, 0.88, 0.89, 0.74, False),  # rear fascia
        (2.36,  0.28, 0.76, 0.86, 0.78, 0.80, 0.68, False),
    ]
    build_lofted_car_body("SedanBody", stations, subsurf_levels=2, mat_body=mat_body, mat_glass=mat_glass, mat_trim=mat_trim, mat_headlight=mat_head, mat_taillight=mat_tail)

    # Front grille, twin projector headlights, full-width rear LED lightbar, side mirrors, diffuser
    add_light_strip("FrontGrille", (0.0, -2.31, 0.44), (0.92, 0.08, 0.22), mat_trim, 0.02)
    add_light_strip("HeadlightL", (0.64, -2.24, 0.64), (0.34, 0.14, 0.10), mat_head, 0.015)
    add_light_strip("HeadlightR", (-0.64, -2.24, 0.64), (0.34, 0.14, 0.10), mat_head, 0.015)
    add_light_strip("TaillightBar", (0.0, 2.30, 0.86), (1.52, 0.09, 0.09), mat_tail, 0.015)
    add_light_strip("TaillightL", (0.62, 2.28, 0.84), (0.38, 0.11, 0.13), mat_tail, 0.015)
    add_light_strip("TaillightR", (-0.62, 2.28, 0.84), (0.38, 0.11, 0.13), mat_tail, 0.015)
    add_light_strip("RearDiffuser", (0.0, 2.31, 0.30), (1.36, 0.10, 0.14), mat_trim, 0.015)
    add_side_mirrors("Sedan", -0.68, 0.96, 0.90, mat_body, mat_trim)

    # 4 Wheels (radius 0.34m)
    for wn, wx, wy in (("WheelFL", 0.84, -1.42), ("WheelFR", -0.84, -1.42), ("WheelRL", 0.84, 1.38), ("WheelRR", -0.84, 1.38)):
        w = create_alloy_wheel(wn, 0.34, 0.24, spokes=7, mat_tire=mat_tire, mat_rim=mat_rim, mat_disc=mat_disc)
        w.location = (wx, wy, 0.34)

    out_path = os.path.join(OUT_DIR, "traffic_sedan.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported {out_path} ({os.path.getsize(out_path):,} bytes)")


def build_suv():
    print("=== Building High-Poly Smooth Traffic SUV (traffic_suv.glb) ===")
    clear_scene()
    mat_body = make_pbr_mat("CarBody", (0.14, 0.17, 0.22), metallic=0.80, roughness=0.24, coat=1.0, coat_rough=0.05)
    mat_glass = make_pbr_mat("CarGlass", (0.018, 0.025, 0.038), metallic=0.1, roughness=0.05, coat=1.0, coat_rough=0.02)
    mat_trim = make_pbr_mat("CarTrim", (0.035, 0.038, 0.042), metallic=0.3, roughness=0.5)
    mat_head = make_pbr_mat("Headlight", (0.95, 0.98, 1.0), metallic=0.0, roughness=0.1, emission=(0.90, 0.95, 1.0), emission_strength=8.5)
    mat_tail = make_pbr_mat("Taillight", (0.92, 0.03, 0.03), metallic=0.0, roughness=0.12, emission=(1.0, 0.04, 0.02), emission_strength=8.0)
    mat_tire = make_pbr_mat("TireRubber", (0.035, 0.035, 0.038), metallic=0.0, roughness=0.78)
    mat_rim = make_pbr_mat("AlloyRim", (0.72, 0.74, 0.78), metallic=0.90, roughness=0.20)
    mat_disc = make_pbr_mat("BrakeDisc", (0.35, 0.36, 0.38), metallic=0.88, roughness=0.35)

    # Length 4.92m, width 2.02m, height 1.72m
    stations = [
        (-2.46, 0.30, 0.66, 0.78, 0.80, 0.84, 0.72, False),
        (-2.30, 0.26, 0.82, 0.94, 0.95, 0.98, 0.84, False),
        (-1.60, 0.25, 0.96, 1.02, 1.00, 1.01, 0.88, False),
        (-0.98, 0.24, 1.04, 1.08, 1.01, 1.01, 0.89, False),
        (-0.32, 0.24, 1.08, 1.68, 1.01, 1.00, 0.78, True),
        (0.75,  0.24, 1.10, 1.70, 1.01, 1.00, 0.77, True),
        (1.75,  0.25, 1.12, 1.64, 0.99, 0.98, 0.74, True),
        (2.26,  0.28, 1.10, 1.26, 0.95, 0.95, 0.78, False),
        (2.44,  0.34, 0.96, 1.08, 0.86, 0.88, 0.74, False),
    ]
    build_lofted_car_body("SUVBody", stations, subsurf_levels=2, mat_body=mat_body, mat_glass=mat_glass, mat_trim=mat_trim, mat_headlight=mat_head, mat_taillight=mat_tail)

    add_light_strip("SUVGrille", (0.0, -2.41, 0.62), (1.06, 0.09, 0.32), mat_trim, 0.02)
    add_light_strip("SUVSkidFront", (0.0, -2.40, 0.32), (1.18, 0.10, 0.12), mat_rim, 0.015)
    add_light_strip("HeadlightL", (0.72, -2.34, 0.84), (0.36, 0.15, 0.12), mat_head, 0.015)
    add_light_strip("HeadlightR", (-0.72, -2.34, 0.84), (0.36, 0.15, 0.12), mat_head, 0.015)
    add_light_strip("TaillightBar", (0.0, 2.38, 1.06), (1.68, 0.10, 0.11), mat_tail, 0.015)
    add_light_strip("RoofRailL", (0.68, 0.68, 1.71), (0.05, 1.95, 0.05), mat_rim, 0.01)
    add_light_strip("RoofRailR", (-0.68, 0.68, 1.71), (0.05, 1.95, 0.05), mat_rim, 0.01)
    add_side_mirrors("SUV", -0.72, 1.14, 0.97, mat_body, mat_trim)

    for wn, wx, wy in (("WheelFL", 0.90, -1.52), ("WheelFR", -0.90, -1.52), ("WheelRL", 0.90, 1.48), ("WheelRR", -0.90, 1.48)):
        w = create_alloy_wheel(wn, 0.39, 0.27, spokes=6, mat_tire=mat_tire, mat_rim=mat_rim, mat_disc=mat_disc)
        w.location = (wx, wy, 0.39)

    out_path = os.path.join(OUT_DIR, "traffic_suv.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported {out_path} ({os.path.getsize(out_path):,} bytes)")


def build_semi_truck(is_tanker=False):
    label = "traffic_tanker.glb" if is_tanker else "traffic_truck.glb"
    print(f"=== Building Heavy Highway Semi-Truck ({label}) ===")
    clear_scene()

    cab_col = (0.62, 0.09, 0.08) if is_tanker else (0.16, 0.24, 0.36)
    mat_cab = make_pbr_mat("CabPaint", cab_col, metallic=0.78, roughness=0.25, coat=1.0, coat_rough=0.05)
    mat_glass = make_pbr_mat("CabGlass", (0.02, 0.03, 0.045), metallic=0.1, roughness=0.05, coat=1.0, coat_rough=0.02)
    mat_trim = make_pbr_mat("ChassisMetal", (0.05, 0.052, 0.058), metallic=0.55, roughness=0.45)
    mat_chrome = make_pbr_mat("Chrome", (0.86, 0.88, 0.91), metallic=0.96, roughness=0.12)
    mat_head = make_pbr_mat("Headlight", (0.96, 0.98, 1.0), metallic=0.0, roughness=0.1, emission=(0.95, 0.97, 1.0), emission_strength=9.0)
    mat_tail = make_pbr_mat("Taillight", (0.95, 0.03, 0.02), metallic=0.0, roughness=0.12, emission=(1.0, 0.04, 0.02), emission_strength=8.5)
    mat_amber = make_pbr_mat("AmberMarker", (1.0, 0.55, 0.05), metallic=0.0, roughness=0.15, emission=(1.0, 0.52, 0.04), emission_strength=6.5)
    mat_tire = make_pbr_mat("TireRubber", (0.035, 0.035, 0.038), metallic=0.0, roughness=0.80)

    # Aerodynamic European/Modern Cab-Over Tractor (-5.8m front to -2.6m rear of cab)
    cab_stations = [
        (-5.80, 0.36, 1.05, 1.20, 1.12, 1.16, 1.08, False),
        (-5.65, 0.34, 1.38, 1.55, 1.22, 1.24, 1.18, False),
        (-5.45, 0.34, 1.55, 2.55, 1.24, 1.24, 1.16, True),
        (-4.55, 0.34, 1.60, 3.35, 1.24, 1.24, 1.16, True),
        (-3.35, 0.36, 1.65, 3.58, 1.24, 1.24, 1.18, False),
        (-2.95, 0.38, 1.65, 3.55, 1.22, 1.22, 1.16, False),
    ]
    build_lofted_car_body("TruckCab", cab_stations, subsurf_levels=2, mat_body=mat_cab, mat_glass=mat_glass, mat_trim=mat_trim, mat_headlight=mat_head, mat_taillight=mat_tail)

    # Grille, headlights, amber roof markers, chassis rails
    add_light_strip("TruckGrille", (0.0, -5.75, 0.92), (1.42, 0.10, 0.72), mat_chrome, 0.025)
    add_light_strip("HeadlightL", (0.94, -5.70, 0.68), (0.38, 0.14, 0.18), mat_head, 0.015)
    add_light_strip("HeadlightR", (-0.94, -5.70, 0.68), (0.38, 0.14, 0.18), mat_head, 0.015)
    for mx in (-0.85, -0.42, 0.0, 0.42, 0.85):
        add_light_strip(f"RoofMarker_{mx:.2f}", (mx, -5.05, 3.22), (0.12, 0.08, 0.06), mat_amber, 0.01)

    add_light_strip("ChassisFrame", (0.0, 0.15, 0.72), (0.95, 10.8, 0.28), mat_trim, 0.02)

    if is_tanker:
        # Pressurized stainless steel / hazard fuel tanker cylinder (-2.5m to +5.8m)
        mat_tank = make_pbr_mat("TankSteel", (0.76, 0.79, 0.83), metallic=0.92, roughness=0.16, coat=0.6, coat_rough=0.08)
        mat_hazard = make_pbr_mat("HazardStripe", (0.92, 0.26, 0.04), metallic=0.25, roughness=0.32, emission=(0.9, 0.22, 0.02), emission_strength=1.4)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=36, radius1=1.18, radius2=1.18, depth=8.2)
        import mathutils
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=mathutils.Matrix.Rotation(math.pi * 0.5, 3, 'X'))
        for v in bm.verts:
            v.co.z *= 0.84  # elliptical highway fuel tank cross-section!
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.06, segments=2, affect='EDGES')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        tmesh = bpy.data.meshes.new("TankerCylinderMesh")
        bm.to_mesh(tmesh)
        bm.free()
        for p in tmesh.polygons:
            p.use_smooth = True
        tmesh.materials.append(mat_tank)
        tobj = bpy.data.objects.new("TankerVessel", tmesh)
        tobj.location = (0.0, 1.65, 2.28)
        bpy.context.collection.objects.link(tobj)

        # Hazard side & rear reflector bands + cradle ribs
        add_light_strip("HazardBandL", (1.16, 1.65, 2.24), (0.05, 7.6, 0.22), mat_hazard, 0.01)
        add_light_strip("HazardBandR", (-1.16, 1.65, 2.24), (0.05, 7.6, 0.22), mat_hazard, 0.01)
        add_light_strip("HazardRearPlacard", (0.0, 5.78, 2.28), (0.65, 0.06, 0.65), mat_hazard, 0.01)
        for ry in (-1.4, 0.6, 2.6, 4.6):
            add_light_strip(f"Cradle_{ry}", (0.0, ry, 1.25), (2.25, 0.18, 0.45), mat_trim, 0.02)
    else:
        # Clean ribbed metallic cargo box trailer (-2.6m to +5.8m)
        mat_box = make_pbr_mat("TrailerBox", (0.78, 0.80, 0.84), metallic=0.55, roughness=0.34, coat=0.4, coat_rough=0.12)
        add_light_strip("CargoTrailer", (0.0, 1.60, 2.48), (2.46, 8.40, 2.58), mat_box, 0.05)
        add_light_strip("SideGuardL", (1.18, 1.40, 0.86), (0.06, 4.20, 0.34), mat_chrome, 0.01)
        add_light_strip("SideGuardR", (-1.18, 1.40, 0.86), (0.06, 4.20, 0.34), mat_chrome, 0.01)
        for sy in (-1.8, 0.4, 2.6, 4.8):
            add_light_strip(f"SideMarkerL_{sy}", (1.24, sy, 1.22), (0.03, 0.24, 0.06), mat_amber, 0.005)
            add_light_strip(f"SideMarkerR_{sy}", (-1.24, sy, 1.22), (0.03, 0.24, 0.06), mat_amber, 0.005)

    # Rear underrun bumper + bright truck taillight clusters
    add_light_strip("RearUnderrun", (0.0, 5.76, 0.68), (2.36, 0.14, 0.24), mat_trim, 0.02)
    add_light_strip("TruckTailL", (0.86, 5.80, 0.72), (0.52, 0.08, 0.16), mat_tail, 0.012)
    add_light_strip("TruckTailR", (-0.86, 5.80, 0.72), (0.52, 0.08, 0.16), mat_tail, 0.012)
    add_light_strip("TruckRearUpperTailL", (1.02, 5.78, 3.55 if not is_tanker else 2.28), (0.24, 0.07, 0.10), mat_tail, 0.01)
    add_light_strip("TruckRearUpperTailR", (-1.02, 5.78, 3.55 if not is_tanker else 2.28), (0.24, 0.07, 0.10), mat_tail, 0.01)

    # 8 Wheel assemblies (Front steer + Drive axle + Dual Trailer axles, radius 0.50m)
    wheel_specs = [
        ("WheelFL", 1.06, -4.65), ("WheelFR", -1.06, -4.65),
        ("WheelDriveL", 1.06, -2.55), ("WheelDriveR", -1.06, -2.55),
        ("WheelTrail1L", 1.06, 3.65), ("WheelTrail1R", -1.06, 3.65),
        ("WheelTrail2L", 1.06, 4.85), ("WheelTrail2R", -1.06, 4.85),
    ]
    for wn, wx, wy in wheel_specs:
        w = create_alloy_wheel(wn, 0.50, 0.34, spokes=8, mat_tire=mat_tire, mat_rim=mat_chrome, mat_disc=mat_trim)
        w.location = (wx, wy, 0.50)

    out_path = os.path.join(OUT_DIR, label)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    build_sedan()
    build_suv()
    build_semi_truck(is_tanker=False)
    build_semi_truck(is_tanker=True)
    print("=== ALL 4 TRAFFIC GLB ASSETS BUILT SUCCESSFULLY ===")
