from pathlib import Path
import bpy,json
from mathutils import Vector
root=Path(__file__).resolve().parent.parent
prior=root/'角色搭配_20261114.nosync'
scope={'__file__':str(prior/'prepare_assets.py')}
exec(compile((prior/'prepare_assets.py').read_text().split('\njobs=',1)[0],str(prior/'prepare_assets.py'),'exec'),scope)
out=Path(__file__).resolve().parent/'brow-posters-v2';out.mkdir(exist_ok=True)
for key in sorted(scope['parts']):
 if not key.startswith('Eyb_'):continue
 bpy.ops.wm.read_factory_settings(use_empty=True)
 avatar='Player0'+str((2 if '_OCT' in key else 0)+(1 if key.endswith('_M') else 0))
 _,rig,body=scope['load'](avatar,bpy.context.scene.collection)
 _,br,brows=scope['scope']['load'](key,bpy.context.scene.collection,rig,'Head','Head_Root')
 face=[o for o in body if o.name.startswith(('Body_Model__M_Face','Eye_','Eyelids_','Mouth00_','Tooth_'))]
 for o in body:
  if o not in face:o.hide_render=True
 scope['H']['setup_preview'](face+brows)
 lo,hi=scope['H']['bounds'](face+brows);center=(lo+hi)/2;span=max(hi-lo)
 scene=bpy.context.scene;scene.camera.location=center+Vector((0,-3,0))*span
 scene.camera.rotation_euler=(center-scene.camera.location).to_track_quat('-Z','Y').to_euler()
 scene.camera.data.ortho_scale=max(hi.x-lo.x,(hi.z-lo.z)*1.6)*1.12
 scene.render.resolution_x=512;scene.render.resolution_y=320;scene.cycles.samples=32
 scene.render.filepath=str(out/(key+'.png'));bpy.ops.render.render(write_still=True)
 print('BROW_POSTER_OK',key,flush=True)
