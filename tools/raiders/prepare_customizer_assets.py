"""Build composable, self-contained skinned assets from verified native sources."""
from pathlib import Path
import bpy,base64,gc,json,math,re,struct,sys,traceback,zlib
import numpy as np
from mathutils import Vector
work=Path(__file__).resolve().parent
root=work.parent
old=root/'涂击队服装组装_20261114.nosync'
scope={'__file__':str(old/'assemble.py')}
exec(compile((old/'assemble.py').read_text().split('\nwanted=set(',1)[0],str(old/'assemble.py'),'exec'),scope)
H,fix=scope['H'],scope['fix']
parts={**scope['parts'],**json.loads((work/'inspection.json').read_text())['parts']}
scope['parts'].update(parts)
out=work/'assets'
out.mkdir(exist_ok=True)
revision=4

def png_bytes(a,linear=True):
 a=a.copy()
 if linear:a[:,:,:3]=fix['encode'](a[:,:,:3])
 a=np.rint(np.clip(a,0,1)*255).astype(np.uint8)
 h,w,c=a.shape
 def chunk(tag,p):return struct.pack('>I',len(p))+tag+p+struct.pack('>I',zlib.crc32(tag+p)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6 if c==4 else 2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+row.tobytes() for row in a[::-1]),6))+chunk(b'IEND',b'')

def uri(a,linear=True):return 'data:image/png;base64,'+base64.b64encode(png_bytes(a,linear)).decode()

def material(m):
 tree=m.node_tree
 bs=scope['bs'](m)
 linked=[]
 def visit(s):
  if not s.links:return
  n=s.links[0].from_node
  if n.type=='TEX_IMAGE':linked.append(n)
  else:
   for q in n.inputs:visit(q)
 visit(bs.inputs['Base Color']);visit(bs.inputs['Alpha'])
 w=max([n.image.size[0] for n in linked]+[1]);h=max([n.image.size[1] for n in linked]+[1])
 signatures={str(fix['signature'](n.inputs['Vector'])) for n in linked}
 assert len(signatures)<=1,(m.name,signatures)
 def value(s,team=None):
  if not s.links:
   v=s.default_value
   return np.array(list(v)[:3] if hasattr(v,'__len__') else [v],np.float32)[None,None,:]
  l=s.links[0];n=l.from_node
  if n.type=='TEX_IMAGE':
   a=fix['resize'](fix['pixels'](n.image),w,h,n.extension=='REPEAT')
   return a[:,:,3:4] if l.from_socket.name=='Alpha' else a[:,:,:3]
  if n.type=='RGB':return np.array([team]*3 if team is not None and n.name=='ResourcePack_TeamColor' else list(n.outputs[0].default_value)[:3],np.float32)[None,None,:]
  if n.type=='MIX_RGB':
   f,a,b=[value(n.inputs[i],team) for i in range(3)]
   return (1-f)*a+f*(a*b if n.blend_type=='MULTIPLY' else b) if n.blend_type in ('MIX','MULTIPLY') else (_ for _ in ()).throw(ValueError(n.blend_type))
  if n.type=='MATH':
   a,b=[value(n.inputs[i],team) for i in range(2)]
   return {'LESS_THAN':lambda:(a<b).astype(np.float32),'GREATER_THAN':lambda:(a>b).astype(np.float32),'SUBTRACT':lambda:a-b,'MULTIPLY':lambda:a*b}[n.operation]()
  raise ValueError((m.name,n.name,n.type))
 alpha=np.broadcast_to(value(bs.inputs['Alpha']),(h,w,1))
 def rgba(team=None):return np.concatenate((np.broadcast_to(value(bs.inputs['Base Color'],team),(h,w,3)),alpha),axis=-1)
 a=rgba()
 alpha_mode='OPAQUE' if float(alpha.min())>.999 else ('MASK' if m.get('RI_gsys_render_state_mode')=='mask' else 'BLEND')
 if not linked and not tree.nodes.get('ResourcePack_TeamColor'):
  for k in list(m.keys()):del m[k]
  m['outputAlphaMode']=alpha_mode
  return
 if tree.nodes.get('ResourcePack_TeamColor'):
  m['tintBlack']=uri(rgba(0));m['tintWhite']=uri(rgba(1))
 name=re.sub(r'[^a-zA-Z0-9_-]','_',m.name)
 p=out/(name+'.png');p.write_bytes(png_bytes(a))
 im=bpy.data.images.load(str(p),check_existing=False);im.pack()
 n=tree.nodes.new('ShaderNodeTexImage');n.image=im
 if linked:
  for l in list(linked[0].inputs['Vector'].links):tree.links.new(l.from_socket,n.inputs['Vector'])
 tree.links.new(n.outputs['Color'],bs.inputs['Base Color'])
 tree.links.new(n.outputs['Alpha'],bs.inputs['Alpha'])
 bs.inputs['Base Color'].default_value=(1,1,1,1)
 bs.inputs['Alpha'].default_value=1
 # Original texture flags determine opaque/mask/blend, with the alpha clip baked.
 for k in list(m.keys()):
  if k not in ('tintBlack','tintWhite'):del m[k]
 m['outputAlphaMode']=alpha_mode

def meshes_for(arm):return [o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]

def coords(o):
 e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh()
 a=np.array([e.matrix_world@v.co for v in m.vertices]);e.to_mesh_clear();return a

def merge(source,target):
 meshes=meshes_for(source)
 before={o:coords(o) for o in meshes}
 missing=[b for b in source.data.bones if b.name not in target.data.bones and b.name!='nw4f_root']
 if missing:
  bpy.ops.object.select_all(action='DESELECT');target.select_set(True);bpy.context.view_layer.objects.active=target
  bpy.ops.object.mode_set(mode='EDIT')
  for bone in missing:
   b=target.data.edit_bones.new(bone.name);b.length=bone.length
   b.matrix=target.matrix_world.inverted()@source.matrix_world@bone.matrix_local
  for bone in missing:
   if bone.parent:target.data.edit_bones[bone.name].parent=target.data.edit_bones.get(bone.parent.name)
  bpy.ops.object.mode_set(mode='OBJECT')
 for o in meshes:
  for group in list(o.vertex_groups):
   if group.name=='nw4f_root':group.name='Skl_Root'
  used={g.group for v in o.data.vertices for g in v.groups if g.weight>0}
  assert all(o.vertex_groups[i].name in target.data.bones for i in used),(source.name,[o.vertex_groups[i].name for i in used if o.vertex_groups[i].name not in target.data.bones])
  # Rebinding uses the character's rest bones. Garment finger axes can differ;
  # evaluated rest geometry is checked below and motion is checked after import.
  world=o.matrix_world.copy();o.parent=target;o.matrix_world=world
  for mod in o.modifiers:
   if mod.type=='ARMATURE':mod.object=target
 bpy.context.view_layer.update()
 assert max([float(np.max(np.abs(coords(o)-a))) for o,a in before.items()]+[0])<.0001
 bpy.data.objects.remove(source,do_unlink=True)

def head_parent(arm,target):
 world=arm.matrix_world.copy();arm.parent=target;arm.parent_type='BONE';arm.parent_bone='Head'
 bpy.context.view_layer.update();arm.matrix_world=world

def clean():
 for o in list(bpy.data.objects):
  if o.type not in ('MESH','ARMATURE'):bpy.data.objects.remove(o,do_unlink=True)
 for o in bpy.data.objects:
  for k in list(o.keys()):
   if k not in ('role','canonicalRig'):del o[k]
  if o.type=='ARMATURE':
   for b in o.data.bones:
    for k in list(b.keys()):del b[k]

def export(key,meta):
 clean()
 for mat in {m for o in bpy.context.scene.objects if o.type=='MESH' for m in o.data.materials if m}:material(mat)
 for o in bpy.context.scene.objects:o.select_set(True)
 bpy.context.view_layer.update()
 counts=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')
 target=out/(key+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_skins=True,export_animations=False,export_extras=True,export_normals=True,export_tangents=False,export_yup=True)
 raw=target.read_bytes();size=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+size]);binary=raw[28+size:]
 d['scenes'][d.get('scene',0)]['extras']=meta
 for m in d['materials']:
  mode=m.get('extras',{}).pop('outputAlphaMode','OPAQUE')
  m['alphaMode']=mode
  if mode=='MASK':m['alphaCutoff']=.5
 assert d.get('skins') and all('bufferView' in im for im in d.get('images',[]))
 j=json.dumps(d,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4)
 target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary)
 # Independent Blender reload catches malformed skin graphs and texture links.
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(target))
 assert all(i.packed_file for i in bpy.data.images if i.type=='IMAGE')
 for o in bpy.context.scene.objects:
  if o.type=='MESH':assert np.isfinite(coords(o)).all()
 report={'key':key,'revision':revision,'bytes':target.stat().st_size,'sha256':H['sha'](target),'skins':len(d['skins']),'images':len(d.get('images',[])),'materials':len(d.get('materials',[])),'polygons':counts}
 (out/(key+'.json')).write_text(json.dumps(report))
 print('ASSET_OK',key,report['bytes'],flush=True)

def load(name,collection):return scope['load'](name,collection)

def avatar(key):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 coll=bpy.context.scene.collection
 row,rig,meshes=load(key,coll)
 rig['canonicalRig']=True
 for o in list(meshes):
  if re.match(r'Mouth0[1-4]_Model',o.name):bpy.data.objects.remove(o,do_unlink=True)
 face=next(o for o in meshes if o.name=='Body_Model__M_Face')
 face['role']='face'
 noear=face.copy();noear.data=face.data.copy();noear.name='Face_NoEars';coll.objects.link(noear)
 scope['remove_ears'](noear);noear['role']='faceNoEars'
 body=next(o for o in meshes if o.name=='Body_Model__M_Body');body['role']='body'
 eye=next(o for o in meshes if o.name=='Eye_Model__M_Eye');eye['role']='eye'
 eyes=[]
 for i in range(21):
  filename=f'{key}.M_Eye_Alb.{i:02}.bntx.zs'
  candidates=[work/'eye-source'/filename]+list((root/'三游戏模型库_20261103/source-cache.nosync').glob('*-'+filename))
  candidates+=[root/f'涂击队_解包/Raiders/{ver}/romfs/Tex/{filename}' for ver in ('updates/65536','base')]
  src=next((p for p in candidates if p.is_file() and not p.stat().st_flags&0x40000000),None)
  if src is None:src=H['ensure_local'](next(p for p in candidates if p.is_file()))
  images,_=H['import_texture'](src,'CustomizerEye__')
  im,=images.values()
  eyes.append(uri(fix['pixels'](im,linear=False),False))
 export(key,{'kind':'avatar','id':key,'eyes':eyes})

def hair(key):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 _,rig,_=load('Player00',bpy.context.scene.collection)
 for o in list(meshes_for(rig)):bpy.data.objects.remove(o,do_unlink=True)
 _,hr,_=scope['load'](key,bpy.context.scene.collection,rig,'Head','Head_Root')
 head_parent(hr,rig);rig['canonicalRig']=True
 export(key,{'kind':'brow' if key.startswith('Eyb_') else 'hair','id':key})

def outfit(r):
 bpy.ops.wm.open_mainfile(filepath=str(old/'assembled'/r['id']/(r['id']+'.blend')),load_ui=False)
 rig=bpy.data.objects['Player00'];rig['canonicalRig']=True
 body=bpy.data.objects['Body_Model__M_Body'];bodymat=body.data.materials[0];bs=scope['bs'](bodymat)
 # Preserve the reviewed outfit's exact fitted alpha mask for the initial body.
 alpha=bs.inputs['Alpha'].links[0].from_node.inputs[1].links[0].from_node.inputs[0].links[0].from_node if False else None
 mask=next(n.image for n in body.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image and n.label=='服装遮罩')
 masks={'Player00':uri(fix['pixels'](mask,linear=False),False)}
 for name in (r['base'],r['glove']):merge(bpy.data.objects[name],rig)
 if r['gear_id']=='Clt_SPRL002':merge(bpy.data.objects['Btm_000_F'],rig)
 if r['head']:head_parent(bpy.data.objects[r['head']],rig)
 for name in (r['hair'],r['brow']):
  if not name:continue
  arm=bpy.data.objects[name]
  for o in meshes_for(arm):bpy.data.objects.remove(o,do_unlink=True)
  bpy.data.objects.remove(arm,do_unlink=True)
 for o in meshes_for(rig):
  if o.name.startswith(('Body_','Eye_','Eyelids_','Mouth','Tooth_')):bpy.data.objects.remove(o,do_unlink=True)
 garments=[o for o in bpy.context.scene.objects if o.type=='MESH']
 original=next(n.image for n in bodymat.node_tree.nodes if n.type=='TEX_IMAGE' and n.label=='游戏原始服装遮罩')
 rawmask=fix['pixels'](original or mask,linear=False)[:,:,3]
 for key in ('Player01','Player02','Player03'):
  _,extra,objects=load(key,bpy.context.scene.collection)
  b=next(o for o in objects if o.name.startswith('Body_Model__M_Body'))
  fitted=rawmask if r['gear_id']=='Clt_SPRL001' else scope['fit_mask'](b,garments,rawmask)
  masks[key]=uri(np.repeat(fitted[:,:,None],4,axis=2),False)
  for o in objects:bpy.data.objects.remove(o,do_unlink=True)
  bpy.data.objects.remove(extra,do_unlink=True)
 export(r['gear_id'],{'kind':'outfit','id':r['gear_id'],'bodyMasks':masks,'hideHair':not bool(r['hair']),'hideEars':r['hide_ear']})

jobs=[('avatar',k) for k in ('Player00','Player01','Player02','Player03')]+[('hair',k) for k in sorted(parts) if k.startswith(('Har_','Eyb_'))]+[('outfit',r) for r in scope['recipes']]
wanted=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
for kind,item in jobs:
 key=item['gear_id'] if isinstance(item,dict) else item
 if wanted and key not in wanted:continue
 report=out/(key+'.json')
 if report.exists() and json.loads(report.read_text()).get('revision')==revision:continue
 try:
  globals()[kind](item)
  (out/(key+'.failure')).unlink(missing_ok=True)
 except Exception:
  (out/(key+'.failure')).write_text(traceback.format_exc());traceback.print_exc();print('ASSET_FAILED',key,flush=True)
 gc.collect()
