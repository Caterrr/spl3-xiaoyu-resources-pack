"""Bind a complete customizer export to the animation rig stored in this file."""
import re
import tempfile
from array import array
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def active(obj, mode='OBJECT'):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if mode != 'OBJECT':
        bpy.ops.object.mode_set(mode=mode)


def bind_world(pose_bone, rig, name):
    constraint = pose_bone.constraints.new('COPY_TRANSFORMS')
    constraint.name = '动画控制'
    constraint.target = rig
    constraint.subtarget = name
    constraint.target_space = constraint.owner_space = 'WORLD'


def edit_bone(rig, name, matrix, parent, length, group):
    bone = rig.data.edit_bones.new(name)
    bone.tail = (0, 0.1, 0)
    bone.matrix = matrix
    bone.length = max(length, .012)
    bone.use_deform = False
    bone.parent = rig.data.edit_bones[parent]
    for collection in list(bone.collections):
        collection.unassign(bone)
    rig.data.collections[group].assign(bone)
    return bone.name


def hair_label(name):
    side = re.search(r'_(L|R)(?:_|$)', name)
    label = re.sub(r'_(L|R)(?=_|$)', '', name)
    if label == 'Z_Hair':
        label = '发梢'
    labels = {'Head_Root': '整体', 'Head': '整体', 'Front': '刘海', 'Nape': '后颈',
              'Hair': '发束', 'Back': '后发', 'Side': '侧发', 'Center': '中束'}
    for word, cn in labels.items():
        if label == word or label.startswith(word + '_'):
            label = cn + label[len(word):]
            break
    return 'CTRL-发 ' + label.replace('_', ' ') + ('.' + side[1] if side else '')


def weighted(arm, meshes):
    names = set()
    for mesh in meshes:
        if mesh.find_armature() != arm:
            continue
        groups = {w.group for v in mesh.data.vertices for w in v.groups if w.weight > 1e-5}
        names.update(mesh.vertex_groups[i].name for i in groups)
    return names


def braid_tips(arm, meshes):
    # The Raiders braid has two terminal joints and a lower fringe joint that
    # ship without weights. Split their parent weights using the authored falloff.
    if arm.name != 'Har_SQD002_F' or 'Front_2' not in arm.pose.bones:
        return {}
    for obj in meshes:
        if obj.find_armature() != arm:
            continue
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        heights = [(evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices]
        for parent, tip, height, width in [('Hair_2_L', 'Z_Hair_L', 1.17, .12),
                                           ('Hair_2_R', 'Z_Hair_R', 1.17, .12),
                                           ('Front_1', 'Front_2', 1.71, .065)]:
            group = obj.vertex_groups.get(parent)
            if group is None:
                continue
            end = obj.vertex_groups.get(tip) or obj.vertex_groups.new(name=tip)
            for vert in obj.data.vertices:
                weight = next((w.weight for w in vert.groups if w.group == group.index), 0)
                z = heights[vert.index]
                t = min(1., max(0., (height - z) / width))
                amount = weight * t*t*(3 - 2*t)
                if amount:
                    group.add([vert.index], weight - amount, 'REPLACE')
                    end.add([vert.index], amount, 'ADD')
    return {'Z_Hair_L': 1.115, 'Z_Hair_R': 1.115}


def attach_rigs(rig, arms, meshes):
    # Jaw rotation is driven directly. Both drivers and constraints must reach the imported skeleton.
    driven_paths = {f.data_path.rpartition(".")[0] for f in rig.animation_data.drivers} if rig.animation_data else set()
    inverse = rig.matrix_world.inverted()
    bind = []
    hairs = []
    body = next(a for a in arms if 'Skl_Root' in a.pose.bones)
    adapted = {}
    for arm in arms:
        hair = arm.name.startswith('Har_')
        brow = arm.name.startswith('Eyb_')
        pivots = braid_tips(arm, meshes) if hair else {}
        weighted_names = weighted(arm, meshes) if hair else set()
        for p in arm.pose.bones:
            if hair and p.name in weighted_names:
                parent = p.parent
                while parent and parent.name not in weighted_names:
                    parent = parent.parent
                hairs.append((arm, p.name, parent.name if parent else None,
                              inverse @ arm.matrix_world @ p.matrix, p.length, pivots.get(p.name)))
            elif (arm == body or brow) and p.name in rig.pose.bones:
                driven = rig.pose.bones[p.name]
                if driven.constraints or driven.path_from_id() in driven_paths:
                    bind.append((arm, p.name, inverse @ arm.matrix_world @ p.matrix, p.length))
    active(rig, 'EDIT')
    for arm, name, matrix, length in bind:
        # The offset child drives the original bone even when the importer's
        # roll or its rest pose differs from the template.
        target = edit_bone(rig, 'MCH-输出 ' + name, matrix, name, length, '内部约束')
        adapted[arm, name] = target
    hair_controls = {}
    reflection = Matrix.Diagonal(Vector((-1., 1., 1., 1.)))
    rest = {hair_label(n): m for _, n, _, m, _, _ in hairs}
    pending = list(hairs)
    while pending:
        previous = len(pending)
        for item in list(pending):
            arm, name, parent, matrix, length, pivot = item
            if parent and (arm, parent) not in hair_controls:
                continue
            label = hair_label(name)
            orientation = matrix.copy()
            if label.endswith('.R') and label[:-2] + '.L' in rest:
                orientation = reflection @ rest[label[:-2] + '.L'] @ reflection
                orientation.translation = matrix.translation
            if pivot is not None:
                orientation[2][3] = pivot
            control = edit_bone(rig, label, orientation,
                                hair_controls.get((arm, parent), 'CTRL-头'), length, '头发')
            hair_controls[arm, name] = control
            adapted[arm, name] = edit_bone(rig, 'MCH-发束 ' + name, matrix, control, length, '内部约束')
            pending.remove(item)
        if len(pending) == previous:
            raise ValueError('发型骨链不完整')
    bpy.ops.object.mode_set(mode='OBJECT')
    shape = bpy.data.objects['YY Hair Circle']
    for name in hair_controls.values():
        p = rig.pose.bones[name]
        p.custom_shape = shape
        p.use_custom_shape_bone_size = False
        p.custom_shape_scale_xyz = (.045,) * 3
        p.custom_shape_rotation_euler = p.bone.matrix_local.to_quaternion().inverted().to_euler()
        p.custom_shape_wire_width = 2
        p.rotation_mode = 'XYZ'
        p.lock_location = (False,) * 3
        p.lock_scale = (True,) * 3
        p.bone.color.palette = 'CUSTOM'
        p.bone.color.custom.normal = (.65, .28, .96)
        p.bone.color.custom.select = (.9, .68, 1)
        p.bone.color.custom.active = (1, 1, .75)
    for (arm, bone), target in adapted.items():
        bind_world(arm.pose.bones[bone], rig, target)
    for arm in arms:
        arm.hide_set(True)
    return hair_controls


def wire_eyes(mesh):
    material = mesh.data.materials[0]
    surface = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    def texture(socket):
        if not socket.links:
            return None
        node = socket.links[0].from_node
        if node.type == 'NORMAL_MAP':
            return texture(node.inputs['Color'])
        return node.image if node.type == 'TEX_IMAGE' else None
    images = {key: texture(surface.inputs[key]) for key in ('Base Color', 'Normal', 'Emission Color')}
    if not images['Base Color']:
        raise ValueError('眼部贴图缺失')
    mesh.data.materials.clear()
    for side in ('L', 'R'):
        mat = bpy.data.materials['眼球材质.' + side]
        tree = mat.node_tree
        for n in tree.nodes:
            role = n.get('yy_texture')
            if role:
                n.image = images[role]
            if n.type == 'UVMAP':
                n.uv_map = mesh.data.uv_layers.active.name
        original = next(n for n in tree.nodes if n.get('yy_eye_surface'))
        for key in ('Roughness', 'Metallic', 'Emission Strength', 'Specular IOR Level'):
            original.inputs[key].default_value = surface.inputs[key].default_value
        mesh.data.materials.append(mat)
    for face in mesh.data.polygons:
        face.material_index = 0 if (mesh.matrix_world @ face.center).x > 0 else 1


def assemble(filepath):
    rig = next(o for o in bpy.context.scene.objects if o.get('rig_id') == 'riki_animator_v3')
    if rig.get('yy_ready'):
        return rig
    previous = set(bpy.data.objects)
    active(rig)
    previous_bones = {b.name for b in rig.data.bones}
    try:
        result = bpy.ops.import_scene.gltf(filepath=str(filepath), import_pack_images=True,
                                           disable_bone_shape=True, bone_heuristic='BLENDER')
        if 'FINISHED' not in result:
            raise RuntimeError('搭配模型读取失败')
        objects = set(bpy.data.objects) - previous
        arms = [o for o in objects if o.type == 'ARMATURE']
        meshes = [o for o in objects if o.type == 'MESH']
        eye = next(m for m in meshes if m.name.startswith('Eye_Model__'))
        bpy.context.view_layer.update()
        attach_rigs(rig, arms, meshes)
        wire_eyes(eye)
        for o in objects:
            if o.type == 'EMPTY':
                o.hide_set(True)
    except Exception:
        active(rig, 'EDIT')
        for bone in list(rig.data.edit_bones):
            if bone.name not in previous_bones:
                rig.data.edit_bones.remove(bone)
        bpy.ops.object.mode_set(mode='OBJECT')
        bpy.data.batch_remove(set(bpy.data.objects) - previous)
        raise
    active(rig, 'POSE')
    rig['yy_ready'] = True
    bpy.context.view_layer.update()
    return rig


def initialize():
    scene = bpy.context.scene
    if 'yy_character_data' not in scene:
        return
    data = array('i', scene['yy_character_data']).tobytes()
    if data[:4] != b'glTF' or int.from_bytes(data[8:12], 'little') != len(data):
        raise ValueError('角色搭配数据不完整，请重新下载')
    with tempfile.TemporaryDirectory(prefix='squid-avatar-') as folder:
        filepath = Path(folder, 'Character.glb')
        filepath.write_bytes(data)
        assemble(filepath)
    del scene['yy_character_data']
    ui = bpy.data.texts.get('RIKI_Animator.py')
    if ui:
        exec(compile(ui.as_string(), ui.name, 'exec'), {'__name__': '__main__'})
    area = bpy.context.area
    if area and area.type in {'TEXT_EDITOR', 'CONSOLE'}:
        area.type = 'VIEW_3D'
    if area and area.type == 'VIEW_3D':
        view = area.spaces.active
        view.region_3d.view_location = (0, 0, .96)
        view.region_3d.view_distance = 3.3
        view.region_3d.view_rotation = Vector((.1, 1, -.015)).to_track_quat('-Z', 'Y')
        view.region_3d.view_perspective = 'ORTHO'
        view.shading.type = 'MATERIAL'
        view.overlay.show_relationship_lines = False
        view.overlay.show_extras = False


if __name__ == '__main__':
    initialize()
