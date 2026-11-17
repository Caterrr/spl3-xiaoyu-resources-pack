"""Build in Blender 4.5 with --factory-startup -b -P this.py -- original.blend output.blend."""
import bpy
import math
import sys
from array import array
from pathlib import Path
from mathutils import Matrix

source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
folder = Path(__file__).parent
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
with bpy.data.libraries.load(str(source)) as (available, data):
    data.objects = [name for name in available.objects if name == 'RIKI · 动画控制']
    data.materials = ['眼球材质.L', '眼球材质.R']
    data.texts = ['RIKI_Animator.py']
rig = data.objects[0]
scene.collection.objects.link(rig)
rig.parent = None
rig.matrix_world = Matrix.Identity(4)
rig.name = '奇迹鱿鱿 · 动画控制'
shapes = bpy.data.collections.new('控制器形状')
scene.collection.children.link(shapes)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
shapes.hide_render = True
for obj in {p.custom_shape for p in rig.pose.bones if p.custom_shape}:
    shapes.objects.link(obj)
    obj.hide_set(True)
    obj.hide_render = True
rig.data.pose_position = 'POSE'
if rig.animation_data:
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
for p in rig.pose.bones:
    if p.name.startswith('CTRL'):
        p.matrix_basis = Matrix.Identity(4)
        for key in p.keys():
            if isinstance(p[key], (int, float)):
                p[key] = p.id_properties_ui(key).as_dict().get('default', 0)
bpy.ops.object.mode_set(mode='EDIT')
for bone in list(rig.data.edit_bones):
    if bone.name.startswith(('CTRL-发 ', 'DEF-Hair-')):
        rig.data.edit_bones.remove(bone)
bpy.ops.object.mode_set(mode='OBJECT')
verts = [(math.cos(i*math.tau/32), 0, math.sin(i*math.tau/32)) for i in range(32)]
mesh = bpy.data.meshes.new('发束控制圈')
mesh.from_pydata(verts, [(i,(i+1)%32) for i in range(32)], [])
shape = bpy.data.objects.new('YY Hair Circle', mesh)
shapes.objects.link(shape)
shape.hide_set(True)
shape.hide_render = True
for mat in data.materials:
    mat.use_fake_user = True
    for node in mat.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            node['yy_texture'] = {'Image_8':'Base Color','Image_9':'Emission Color','Image_10':'Normal'}[node.image.name]
            node.image = None
        elif node.type == 'BSDF_PRINCIPLED' and node.inputs['Normal'].is_linked:
            node['yy_eye_surface'] = True
ui = data.texts[0]
ui_source = ui.as_string().replace("bl_label='机械师 力'", "bl_label='奇迹鱿鱿'")
ui.clear()
ui.write(ui_source)
ui.use_fake_user = True
ui.use_module = False
loader = bpy.data.texts.new('搭配装配.py')
loader.write((folder/'assemble.py').read_text())
loader.use_fake_user = True
start = bpy.data.texts.new('打开搭配.py')
start.write('''# 打开当前搭配
# 点击本窗口上方的 ▶，或把鼠标放在这里按 Alt + P。
# 角色出现后可直接摆姿势。保存后，下次打开就会直接进入角色视图。

import bpy
source = bpy.data.texts['搭配装配.py']
exec(compile(source.as_string(), source.name, 'exec'), {'__name__': '__main__'})
''')
start.use_fake_user = True
start.cursor_set(0)
scene['yy_character_data'] = array('i', range(1122071001,1122071017))
rig.data.collections['手指关节'].is_visible = True
rig.data.collections['头发'].is_visible = True
rig.pose.use_mirror_x = True
for p in rig.pose.bones:
    if p.name.startswith('CTRL-'):
        p.bone.select = False
for screen in bpy.data.screens:
    if screen.name.startswith(('Layout','布局')):
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.type = 'TEXT_EDITOR'
                area.spaces.active.text = start
                area.spaces.active.show_line_numbers = False
                area.spaces.active.show_region_ui = False
                area.spaces.active.top = 0
# The source armature may reference its old object's parent, disconnected by now.
bpy.data.orphans_purge(do_recursive=True)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=False)
