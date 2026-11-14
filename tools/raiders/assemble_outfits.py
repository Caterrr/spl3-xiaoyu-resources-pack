from pathlib import Path
import gc, json, re, struct, subprocess, sys, traceback
import bpy
import numpy as np
from mathutils import Vector

work=Path(__file__).resolve().parent
root=work.parent
lib=root/'三游戏模型库_20261103'
script=lib/'scripts.nosync/export_raiders.py'
H={'__file__':str(script)}
exec(compile(script.read_text().split('\nargs=sys.argv',1)[0],str(script),'exec'),H)
fix=H['fix']
parts=json.loads((work/'parts.json').read_text())
recipes=json.loads((work/'preflight.json').read_text())
records={r['source']:r['record'] for r in json.loads((lib/'state/raiders-model-index.json').read_text())}
predecessor=root/'涂击队服装修复_20261114.nosync/repair.py'
common={'__file__':str(predecessor)}
exec(compile(predecessor.read_text().split("\nif '--' in sys.argv:",1)[0],str(predecessor),'exec'),common)
revision=7
sys.path.insert(0,str(work))
from geometry_mask import fit_mask
resolved=json.loads((work/'resolved-sources.json').read_text())

def bs(mat):
    return next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')

def load(name, collection, parent=None, anchor=None, child=None):
    row=parts[name]
    src=H['ensure_local'](row['blend'])
    assert H['sha'](src)==row['blendSha256']
    with bpy.data.libraries.load(str(src),link=False) as (available,take):
        assert name in available.collections
        take.collections=[name]
    component=take.collections[0]
    collection.children.link(component)
    arm,=(o for o in component.all_objects if o.type=='ARMATURE')
    bpy.context.view_layer.update()
    if anchor:
        basis=arm.matrix_world@arm.data.bones[child].matrix_local
        wanted=parent.matrix_world@parent.data.bones[anchor].matrix_local
        transform=arm.matrix_world.copy()
        if child=='Root' and name.startswith('Hed_'):
            transform.translation += wanted.translation-basis.translation
        else:
            transform=wanted@basis.inverted()@transform
        arm.matrix_world=transform
        bpy.context.view_layer.update()
        actual=arm.matrix_world@arm.data.bones[child].matrix_local
        assert (actual.translation-wanted.translation).length<.0002
    return row,arm,[o for o in component.all_objects if o.type=='MESH']

def alpha_clip(mat):
    tree=mat.node_tree
    alpha=bs(mat).inputs['Alpha']
    if not alpha.links or mat.get('RI_gsys_render_state_mode')!='mask':return
    original=alpha.links[0].from_socket
    lt=tree.nodes.new('ShaderNodeMath')
    lt.operation='LESS_THAN'
    lt.inputs[1].default_value=mat.get('RI_gsys_alpha_test_value',.5)
    lt.location=bs(mat).location+Vector((-440,-420))
    clip=tree.nodes.new('ShaderNodeMath')
    clip.operation='SUBTRACT'
    clip.inputs[0].default_value=1
    clip.location=lt.location+Vector((205,0))
    tree.links.new(original,lt.inputs[0])
    tree.links.new(lt.outputs[0],clip.inputs[1])
    tree.links.new(clip.outputs[0],alpha)
    return lt

def replace_materials(r, wear, target):
    row,_,meshes=wear
    overrides=r.get('material_overrides',{})
    changes={}
    if not overrides:return changes
    specs=json.loads(Path(records[Path(row['source']).name]).read_text())['models'][0]['materials']
    mats={m.name.split('__')[-1]:m for o in meshes for m in o.data.materials if m}
    assert overrides.keys()<=mats.keys()
    for spec in specs:
        key=spec['name']
        if key not in overrides:continue
        overrides_for_material=overrides[key]
        mat=mats[key]
        mat['raiders_gear_variant']=r['variant']
        tree=mat.node_tree
        for slot,image_name in overrides_for_material['textures'].items():
            ref,=(x for x in spec['textures'] if slot in x['semantics'] or slot==x['sampler'])
            node,=(n for n in tree.nodes if n.type=='TEX_IMAGE' and n.image and n.image.name.endswith('__'+ref['texture']))
            images,_=H['import_texture'](Path(resolved[r['textures'][image_name]]),r['id']+'__','_n0' in ref['semantics'])
            old=node.image
            node.image=images[image_name]
            node.image.colorspace_settings.name=old.colorspace_settings.name
            node.label=node.label.replace(ref['texture'],image_name)
            if not old.users:bpy.data.images.remove(old)
        for prop,value in overrides_for_material['parameters'].items():
            key='MP_'+prop
            if key in mat and isinstance(value,list) and len(mat[key])>len(value):
                value=value+list(mat[key])[len(value):]
            mat[key]=value
            if prop=='albedo_color':
                bs(mat).inputs['Base Color'].default_value=value
                if mat.get('RI_gsys_render_state_mode')=='translucent':bs(mat).inputs['Alpha'].default_value=value[3]
        if overrides_for_material['textures']:
            ao=tree.nodes.get('ResourcePack_AO')
            if ao:
                tree.links.new(ao.inputs[1].links[0].from_socket,bs(mat).inputs['Base Color'])
                tree.nodes.remove(ao)
            report=fix['apply_material'](mat,{'section':'equipment'},target)
            assert report.get('texture') and min(report['size'])>=256,(mat.name,report)
            changes[mat.name]=report
    return changes

def resident(paths):
    return next((Path(p) for p in paths if not Path(p).stat().st_flags&0x40000000),Path(paths[0]))

def body_mask(obj,r):
    mat,=obj.data.materials
    tree=mat.node_tree
    alpha=bs(mat).inputs['Alpha']
    old=alpha.links[0].from_node
    assert fix['pixels'](old.image,linear=False)[:,:,3].min()==1
    im,=H['import_texture'](Path(resolved[r['alpha_mask'][0]]),r['id']+'__')[0].values()
    assert im.packed_file and min(im.size)>=64
    mask=tree.nodes.new('ShaderNodeTexImage')
    mask.image=im
    mask.label='游戏服装遮罩'
    mask.location=old.location+Vector((0,-390))
    tree.links.new(mask.outputs['Alpha'],alpha)
    return mat,im

def remove_ears(obj):
    import bmesh
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    indices={g.index for g in obj.vertex_groups if g.name in ('Ear_L','Ear_R')}
    weights=bm.verts.layers.deform.active
    faces=[f for f in bm.faces if all(sum(v[weights].get(g,0) for g in indices) > sum(v[weights].values())*.5 for v in f.verts)]
    assert faces and len(faces)<len(bm.faces)*.5
    bmesh.ops.delete(bm,geom=faces,context='FACES')
    bm.to_mesh(obj.data)
    bm.free()

def bake_color(mat, change, body_rgba=None, cutoff=None):
    tree=mat.node_tree
    node=tree.nodes.new('ShaderNodeTexImage')
    source=bpy.data.images.load(change['texture'],check_existing=True)
    node.image=source
    if body_rgba is not None:
        width,height=body_rgba.shape[1],body_rgba.shape[0]
        baked=bpy.data.images.new('PlayerBody_BakedColorAndMask',width=width,height=height,alpha=True)
        baked.pixels.foreach_set(body_rgba.ravel())
        baked.update()
        baked.pack()
        node.image=baked
        tree.links.new(node.outputs['Alpha'],cutoff.inputs[0])
    kind,uv,*_=change['vector_signature']
    assert kind=='UV'
    if uv!='_u0':
        uv_node=tree.nodes.new('ShaderNodeUVMap')
        uv_node.uv_map=uv
        tree.links.new(uv_node.outputs[0],node.inputs['Vector'])
    tree.links.new(node.outputs[0],bs(mat).inputs['Base Color'])

def camera(meshes):
    H['setup_preview'](meshes)
    scene=bpy.context.scene
    lo,hi=H['bounds'](meshes)
    center=(lo+hi)/2
    span=max(hi-lo)
    c=scene.camera
    c.location=center+Vector((1,-2.8,.48))*span
    c.rotation_euler=(center-c.location).to_track_quat('-Z','Y').to_euler()
    c.data.ortho_scale=span*1.12
    scene.cycles.samples=24

def assemble(r):
    target=work/'assembled'/r['id']
    target.mkdir(parents=True,exist_ok=True)
    result=target/'result.json'
    if result.is_file() and json.loads(result.read_text()).get('revision')==revision:return
    assert not r.get('failure')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    display=bpy.data.collections.new(r['gear_id'])
    bpy.context.scene.collection.children.link(display)
    avatar=load(r['avatar'],display)
    _,rig,body=avatar
    for obj in list(body):
        if re.match(r'Mouth0[1-4]_Model',obj.name):
            body.remove(obj)
            bpy.data.objects.remove(obj,do_unlink=True)
    if r['hide_ear']:remove_ears(bpy.data.objects['Body_Model__M_Face'])
    body_obj=bpy.data.objects['Body_Model__M_Body']
    masked,mask=body_mask(body_obj,r)
    change,=(m for m in avatar[0]['material_changes'] if m['material']==masked.name)
    assert change['vector_signature']==['UV','_u0']
    source=bpy.data.images.load(change['texture'],check_existing=True)
    original_mask=fix['pixels'](mask,linear=False)[:,:,3:4]
    wear=load(r['base'],display,rig,'Skl_Root','Skl_Root')
    overrides=replace_materials(r,wear,target)
    glove=load(r['glove'],display,rig,'Wrist_L','Wrist_L')
    for name in ('Wrist_L','Wrist_R'):
        a=rig.matrix_world@rig.data.bones[name].head_local
        b=glove[1].matrix_world@glove[1].data.bones[name].head_local
        assert (a-b).length<.00025,(r['id'],name,a,b)
    items=[avatar,wear,glove]
    if r['head']:items.append(load(r['head'],display,rig,'Head','Root' if r['head'] in ('Hed_SPRL001','Hed_AMB004') else 'Head'))
    if r['hair']:items.append(load(r['hair'],display,rig,'Head','Head_Root'))
    items.append(load(r['brow'],display,rig,'Head','Head_Root'))
    if r['gear_id']=='Clt_SPRL002':items.append(load('Btm_000_F',display,rig,'Skl_Root','Skl_Root'))
    size=max(256,mask.size[0],mask.size[1])
    raw=fix['resize'](original_mask,size,size,False)[:,:,0]
    fitted=raw if r['gear_id']=='Clt_SPRL001' else fit_mask(body_obj,[o for _,_,group in items[1:] for o in group],raw)
    mask_rgba=np.repeat(fitted[:,:,None],4,axis=2).astype(np.float32)
    fitted_image=bpy.data.images.new(r['id']+'_body_mask',width=size,height=size,alpha=True,is_data=True)
    fitted_image.pixels.foreach_set(mask_rgba.ravel())
    fitted_image.update()
    fitted_image.pack()
    alpha_node=bs(masked).inputs['Alpha'].links[0].from_node
    mask_source=masked.node_tree.nodes.new('ShaderNodeTexImage')
    mask_source.label='游戏原始服装遮罩'
    mask_source.image=mask
    mask_source.location=alpha_node.location+Vector((-220,-380))
    alpha_node.image=fitted_image
    alpha_node.label='服装遮罩'
    rgb=fix['resize'](fix['pixels'](source,linear=False)[:,:,:3],size,size)
    body_rgba=np.concatenate((rgb,fitted[:,:,None]),axis=2).astype(np.float32)
    bpy.data.images.remove(source)
    meshes=[o for _,_,group in items for o in group]
    mats={m for o in meshes for m in o.data.materials if m}
    clips={mat:alpha_clip(mat) for mat in mats}
    assert clips[masked]
    assert all(n.image and n.image.packed_file for m in mats for n in m.node_tree.nodes if n.type=='TEX_IMAGE')
    bpy.context.view_layer.update()
    bounds=[list(v) for v in H['bounds'](meshes)]
    counts=(len(meshes),sum(len(p.vertices)-2 for o in meshes for p in o.data.polygons))
    sources=[row['name'] for row,_,_ in items]
    display['source_parts']=json.dumps(sources)
    display['game_alpha_mask']=Path(r['alpha_mask'][0]).name
    if r['variant']:display['game_material_variant']=r['variant']
    blend,glb,png,webp=[target/(r['id']+s) for s in ('.blend','.glb','.png','.webp')]
    camera(meshes)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True)
    common['baked_geometry'](meshes)
    changes={m['material']:m for row,_,_ in items for m in row['material_changes'] if m.get('texture')}
    changes.update(overrides)
    for m in mats:
        if m.name in changes:bake_color(m,changes[m.name],body_rgba if m==masked else None,clips[m])
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_animations=False,export_skins=False,export_extras=True,export_yup=True,export_image_format='AUTO',export_normals=True,export_tangents=True,export_texcoords=True,export_materials='EXPORT')
    H['repair_tangents'](glb)
    raw=glb.read_bytes()
    length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length])
    assert all('bufferView' in x for x in doc['images'])
    mask_mat,=(m for m in doc['materials'] if m['name']==masked.name)
    assert mask_mat.get('alphaMode')=='MASK' and mask_mat['pbrMetallicRoughness'].get('baseColorTexture')
    for name in overrides:
        m,=(x for x in doc['materials'] if x['name']==name)
        assert 'baseColorTexture' in m['pbrMetallicRoughness'] and 'normalTexture' in m
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    assert (len(imported),sum(len(p.vertices)-2 for o in imported for p in o.data.polygons))==counts
    imported_bounds=H['bounds'](imported)
    assert max(abs(bounds[i][j]-imported_bounds[i][j]) for i in range(2) for j in range(3))<.0001
    camera(imported)
    common['render'](png,webp)
    bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False)
    assert all(i.packed_file for i in bpy.data.images if i.type=='IMAGE') and not bpy.data.libraries
    assert len([o for o in bpy.context.scene.objects if o.type=='ARMATURE'])==len(items)
    bpy.context.scene.render.resolution_percentage=70
    common['render'](target/'blender-check.png',target/'blender-check.webp')
    output=dict(id=r['id'],gear_id=r['gear_id'],revision=revision,variant=r['variant'],label=r['label'],parts=sources,triangles=counts[1],bounds=bounds,mask_uv='_u0')
    for kind,path in [('blend',blend),('glb',glb),('poster',webp)]:
        output[kind]=dict(path=str(path),sha256=H['sha'](path),bytes=path.stat().st_size)
    result.write_text(json.dumps(output,ensure_ascii=False,indent=2))
    (target/'failure.txt').unlink(missing_ok=True)
    print('OUTFIT_OK',r['gear_id'],sources,flush=True)

wanted=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
for recipe in recipes:
    if wanted and recipe['gear_id'] not in wanted:continue
    try:assemble(recipe)
    except Exception:
        (work/'assembled'/recipe['id']/'failure.txt').write_text(traceback.format_exc())
        traceback.print_exc()
        print('OUTFIT_FAILED',recipe['gear_id'],flush=True)
    gc.collect()
