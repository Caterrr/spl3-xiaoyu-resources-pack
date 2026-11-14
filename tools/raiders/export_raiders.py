# -*- coding: utf-8 -*-
"""Checkpointed source-native conversion. No production files are modified."""
import bpy, os, sys, io, json, math, hashlib, traceback, time, subprocess, gc
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from mathutils import Matrix,Vector,Euler,Quaternion
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parents[1]
TOOL=OUT/'importer-tools.nosync'
sys.path[:0]=[str(TOOL),str(TOOL/'依赖')]
sys.path.insert(0,str(OUT/'scripts'))
from repair_glb_tangents import repair as repair_tangents
from local_files import read_bytes as read_local_bytes,ensure_local,prepare_output,is_resident
import zstandard
from io_scene_bfres.bfrespy.res_file import ResFile
from io_scene_bfres.bntx.bntx import BNTX
from io_scene_bfres.bntx import brti
from io_scene_bfres.bntx.pixelfmt import swizzle
from io_scene_bfres import mesh_importer,model_importer
from io_scene_bfres.attribute import AttributeFormat
C=Matrix.Rotation(math.pi/2,4,'X')
PYTHON=os.environ.get('RAIDERS_PYTHON','python3')
VERSION='raiders-source-v1'
def sha(p):return hashlib.sha256(read_local_bytes(p)).hexdigest()
def unpack(p):return zstandard.ZstdDecompressor().decompress(read_local_bytes(p))

def fast_deswizzle(width,height,bw,bh,bpp,tile,log2,data,*,ounce=False):
    w=math.ceil(width/bw);h=math.ceil(height/bh);block=1<<log2
    yy,xx=np.indices((h,w),dtype=np.int64);x=xx*bpp
    if tile==1:
        pitch=((w*bpp+31)//32)*32;size=pitch*h;pos=yy*pitch+x
    else:
        pitch=((w*bpp+63)//64)*64;size=pitch*((h+block*8-1)//(block*8))*(block*8)
        gobs=(w*bpp+63)//64
        pos=(yy//(8*block))*512*block*gobs+(x//64)*512*block+(yy%(8*block)//8)*512
        pos+=(x%64//32)*256+(yy%8//2)*64+(x%32//16)*32+(yy%2)*16+x%16
        if ounce:pos^=(((pos>>5)^(pos>>6))&1)*96
    offsets=pos.reshape(-1,1)+np.arange(bpp,dtype=np.int64)[None,:]
    assert offsets.max()<len(data),('texture payload too short',int(offsets.max()),len(data))
    result=np.zeros(size,np.uint8);result[:w*h*bpp]=np.frombuffer(data,np.uint8)[offsets].reshape(-1)
    return result.tobytes()
# Independently compare the address adapter against the original scalar function.
for w,h,bpp,block in [(128,128,16,16),(17,41,8,4),(33,9,4,1)]:
    for y in range(h):
        for x in range(w):
            a=swizzle.__get_addr_block_linear(x,y,w,bpp,0,block)
            by=x*bpp;v=(y//(8*block))*512*block*math.ceil(w*bpp/64)+(by//64)*512*block+(y%(8*block)//8)*512+(by%64//32)*256+(y%8//2)*64+(by%32//16)*32+(y%2)*16+by%16
            assert a==v

def attributes(fvtx,first_vtx):
    result={};count=fvtx.vtx_count-first_vtx
    import struct
    for a in fvtx.attributes.values():
        buff=fvtx.buffers[a.buffer_idx];fmt=AttributeFormat(a.format_.value)
        values=np.array([struct.unpack_from(fmt.read,buff.data[0],(first_vtx+i)*buff.stride+a.offset) for i in range(count)])
        if fmt.func:values=fmt.func(values)
        elif fmt.AttribType.INTEGER not in fmt.flags and fmt.AttribType.SCALED not in fmt.flags:
            values=np.where(values==fmt.min,-1,values/fmt.max) if fmt.AttribType.SIGNED in fmt.flags else values/fmt.max
        result[a.name]=values
    return result
mesh_importer.__get_vtx_attributes=attributes

def bone_matrices(model):
    result=[];bones=list(model.skeleton.bones.values())
    for b in bones:
        rotation=Euler(b.rotation[:3],'XYZ') if b.bone_flags_rotation.name=='EULER_XYZ' else Quaternion((b.rotation[3],*b.rotation[:3]))
        compensation=Matrix.Identity(4)
        if model.skeleton.flags_scaling.name=='MAYA' and b.parent_idx>=0 and b._flags&0x00800000:
            compensation=Matrix.Diagonal(Vector(tuple(1/x for x in bones[b.parent_idx].scale)+(1,)))
        local=Matrix.Translation(Vector(b.position[:3]))@compensation@rotation.to_matrix().to_4x4()@Matrix.Diagonal(Vector(tuple(b.scale[:3])+(1,)))
        result.append(result[b.parent_idx]@local if b.parent_idx>=0 else C@local)
    return result
def import_skeleton(model,skel,collection,copy):
    matrices=bone_matrices(model);data=bpy.data.armatures.new(model.name+'.Armature');ob=bpy.data.objects.new(model.name,data);collection.objects.link(ob)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.mode_set(mode='EDIT');built={}
    for i,b in enumerate(skel.bones.values()):
        bone=data.edit_bones.new(b.name);bone.length=.1
        if b.parent_idx>=0:bone.parent=built[b.parent_idx]
        bone.matrix=matrices[i];built[i]=bone;b.matrix=matrices[i]
    bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
    for i,b in enumerate(skel.bones.values()):
        bone=data.bones[b.name];bone['source_srt']=json.dumps(dict(translation=list(b.position),rotation=list(b.rotation),scale=list(b.scale),rotation_type=b.bone_flags_rotation.name,flags=int(b._flags)))
        if skel.flags_scaling.name=='MAYA' and b.parent_idx>=0 and b._flags&0x00800000:bone.inherit_scale='NONE'
    return ob
model_importer.import_fskl=import_skeleton
mesh_importer._rotate_normal=lambda matrix,normal:(matrix.to_3x3().inverted_safe().transposed()@normal).normalized()

def import_texture(path,prefix,normal=False):
    raw=unpack(path)
    # Assembly imports multiple helper namespaces. Never let another helper's
    # module-global decoder state select the layout for this texture.
    previous=brti.deswizzle
    ounce=raw[32:36]==b'Ounc'
    brti.deswizzle=lambda *args:fast_deswizzle(*args,ounce=ounce)
    try:pack=BNTX(io.BytesIO(raw))
    finally:brti.deswizzle=previous
    result={};details=[]
    for tex in pack.nx.textures:
        if tex.fmt_id==0x1e:
            xy=np.asarray(tex.pixels,dtype=np.float32)
            if normal:
                z=np.sqrt(np.maximum(0,1-np.sum(xy*xy,axis=-1)))
                rgb=np.concatenate((xy,z[...,None]),axis=-1)*.5+.5
            else:
                rg=xy*.5+.5 if tex.fmt_dtype.name=='UNORM' else xy
                rgb=np.concatenate((rg,np.zeros_like(rg[...,:1])),axis=-1)
            rgba=np.concatenate((rgb,np.ones_like(rgb[...,:1])),axis=-1)
        else:rgba=np.asarray(tex.format_.decodepixels(tex.pixels)).reshape(-1,4)[:tex.width*tex.height].reshape(tex.height,tex.width,4)
        if not (normal and tex.fmt_id==0x1e):
            source=rgba.copy()
            for c,selector in enumerate(tex.channel_types):
                rgba[...,c]=0 if selector==0 else 1 if selector==1 else source[...,selector-2]
        assert np.isfinite(rgba).all(),('nonfinite texture',tex.name)
        floating=tex.fmt_dtype.name in ('UHALF','SINGLE') or float(rgba.min())<0 or float(rgba.max())>1
        image=bpy.data.images.new(prefix+tex.name,width=tex.width,height=tex.height,alpha=True,float_buffer=floating,is_data=tex.fmt_dtype.name!='SRGB')
        image.file_format='OPEN_EXR' if floating else 'PNG';image.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel());image.update();image.pack();result[tex.name]=image
        details.append(dict(name=tex.name,width=tex.width,height=tex.height,format=tex.format_.__name__,dtype=tex.fmt_dtype.name,channels=list(tex.channel_types),platform=raw[32:36].decode(),source=str(path),source_sha256=sha(path),normal_xy_reconstructed=normal and tex.fmt_id==0x1e))
    return result,details

# Reuse the source-flagged AO / grayscale team-mask logic already audited for Spl3.
fixpath=TOOL/'fix_materials.py';fix={'__file__':str(fixpath)}
exec(compile(fixpath.read_text().split('\nargs=sys.argv')[0],str(fixpath),'exec'),fix)
_write_png=fix['png']
def local_png(path,color):prepare_output(path);return _write_png(path,color)
fix['png']=local_png
profile=json.loads((TOOL/'lighting.json').read_text())
def bounds(meshes):
    graph=bpy.context.evaluated_depsgraph_get();points=[]
    for ob in meshes:
        ev=ob.evaluated_get(graph);mesh=ev.to_mesh();used={i for p in mesh.polygons for i in p.vertices};points.extend(ev.matrix_world@mesh.vertices[i].co for i in used);ev.to_mesh_clear()
    return Vector([min(p[k] for p in points) for k in range(3)]),Vector([max(p[k] for p in points) for k in range(3)])
def setup_preview(meshes):
    lo,hi=bounds(meshes);center=(lo+hi)/2;span=max(hi-lo);assert span>1e-6
    direction=Vector((1,-1.7,1.15));axis=min(range(3),key=lambda i:(hi-lo)[i])
    if (hi-lo)[axis]<span*.08:
        normal=Vector((0,0,0))
        for ob in meshes:
            transform=ob.matrix_world.to_3x3().inverted_safe().transposed()
            for polygon in ob.data.polygons:normal+=transform@polygon.normal*polygon.area
        if abs(normal[axis])>1e-8:direction=Vector((0,0,0));direction[axis]=1 if normal[axis]>=0 else -1
    scene=bpy.context.scene;camera=bpy.data.objects.new('模型预览相机',bpy.data.cameras.new('模型预览相机'));scene.collection.objects.link(camera);camera.location=center+direction*span*2;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';scene.camera=camera;bpy.context.view_layer.update()
    r=camera.matrix_world.to_quaternion().inverted();pts=[r@(o.matrix_world@Vector(v)-center) for o in meshes for v in o.bound_box];xs=[p.x for p in pts];ys=[p.y for p in pts];camera.data.ortho_scale=max(max(xs)-min(xs),max(ys)-min(ys))*1.18;camera.location+=camera.matrix_world.to_quaternion()@Vector(((max(xs)+min(xs))/2,(max(ys)+min(ys))/2,0));camera.data.clip_end=max(10000,span*10);camera.data.clip_start=max(.00001,min(.1,span*.01))
    for cfg in profile['lights']:
        d=bpy.data.lights.new(cfg['name'],'AREA');d.energy=cfg['power_per_span_squared']*span*span;d.shape='DISK';d.size=cfg['size_per_span']*span;o=bpy.data.objects.new(d.name,d);scene.collection.objects.link(o);o.location=center+Vector(cfg['position'])*span;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
    world=bpy.data.worlds.new('中性棚拍环境');world.use_nodes=True;scene.world=world;bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=profile['world']['color'];bg.inputs['Strength'].default_value=profile['world']['strength']
    for k,v in profile['color_management'].items():setattr(scene.view_settings,k,v)
    scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True;scene.cycles.transparent_max_bounces=64;scene.render.film_transparent=True;scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    return lo,hi

def run(record):
    row=json.loads(Path(record).read_text());modelmeta=row['models'][0];name=modelmeta['name'];ident=name+'-'+row['source_sha256'][:8];folder=OUT/'exports/raiders'/modelmeta['category']/ident;folder.mkdir(parents=True,exist_ok=True)
    reportpath=folder/'result.json'
    if reportpath.exists() and json.loads(reportpath.read_text()).get('ok'):
        previous=json.loads(reportpath.read_text())
        if '--rebuild-cache' not in sys.argv or is_resident(previous['blend']):print('SKIP',ident,flush=True);return
    started=time.time();bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    prefix=ident+'__';refs={};textures={};texdetails=[];inactive_missing=[]
    for m in modelmeta['materials']:
        for ref in m['textures']:
            if not ref['path']:
                if '_m0' in ref['semantics'] and m['options'].get('enable_metalness_map')!='true' and m['parameters'].get('metalness')==0.0:
                    inactive_missing.append(dict(material=m['name'],texture=ref['texture'],semantic='_m0',source_option=m['options'].get('enable_metalness_map'),constant_source_metalness=0.0,action='Keep source constant metalness; do not borrow a namesake texture'));continue
                raise ValueError(('unresolved source texture',ref['texture']))
            old=refs.get(ref['texture']);assert not old or old['path']==ref['path']
            refs[ref['texture']]=dict(ref,semantics=sorted(set(ref['semantics']+(old['semantics'] if old else []))))
    for n,ref in refs.items():
        images,info=import_texture(ref['path'],prefix,'_n0' in ref['semantics']);assert n in images,('source texture name mismatch',n);textures.update(images);texdetails.extend(info)
    assert sha(row['source_path'])==row['source_sha256'];res=ResFile(io.BytesIO(unpack(row['source_path'])));model=res.models[name]
    col=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(col)
    op=SimpleNamespace(name_prefix=prefix,copy_bone_transforms=False,lod_index=0,custom_normals=True)
    importer=model_importer.ModelImporter(SimpleNamespace(operator=op,texture_map=textures));importer.convert_fmdl(model,col);bpy.context.view_layer.update()
    meshes=[o for o in col.objects if o.type=='MESH'];assert len(meshes)==len(modelmeta['shapes']);mats={m for o in meshes for m in o.data.materials if m}
    changes=[];special=[]
    for mat in mats:
        face=mat.get('RI_gsys_render_state_display_face')
        if face=='front':mat.use_backface_culling=True
        for node in mat.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image:
                semantic=node.label.split(' ',1)[0]
                if semantic in ('_ao0','_su0'):node.image.colorspace_settings.name='Non-Color'
        change=fix['apply_material'](mat,{'section':'old' if modelmeta['category']=='weapons' else modelmeta['category']},folder);changes.append(change)
        for key in ['enable_taransmission','enable_calc_color0','enable_transfilm','enable_cheap_sss']:
            if mat.get('SO_'+key)=='true':special.append(dict(material=mat.name,feature=key,reason='game runtime shader retained as source parameters; PBR approximation'))
    assert all(n.image and min(n.image.size)>0 and n.image.packed_file for m in mats for n in m.node_tree.nodes if n.type=='TEX_IMAGE')
    lo,hi=setup_preview(meshes);nativebounds=[list(lo),list(hi)];span=max(hi-lo);triangles=sum(len(p.vertices)-2 for o in meshes for p in o.data.polygons)
    native_geometry={o.name:dict(vertices=len(o.data.vertices),polygons=len(o.data.polygons),uv_layers=[x.name for x in o.data.uv_layers]) for o in meshes}
    blend=folder/(ident+'.blend');glb=folder/(ident+'.glb');poster=folder/(ident+'.png');webp=folder/(ident+'.webp')
    for path in [blend,glb,poster,webp]:prepare_output(path)
    col['source_model']=name;col['source_file']=row['source_path'];col['source_sha256']=row['source_sha256'];bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True)
    graph=bpy.context.evaluated_depsgraph_get();baked=[]
    for ob in meshes:
        ev=ob.evaluated_get(graph);mesh=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=graph);baked.append((ob.name,mesh,ev.matrix_world.copy()))
    for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
    exported=[]
    for n,mesh,matrix in baked:
        ob=bpy.data.objects.new(n,mesh);bpy.context.scene.collection.objects.link(ob);ob.matrix_world=matrix;ob.select_set(True);exported.append(ob)
    for change in changes:
        if not change.get('texture'):continue
        mat=bpy.data.materials[change['material']];tree=mat.node_tree;bs=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED');tex=tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ensure_local(change['texture'])),check_existing=True);tex.image.pack();tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
        sig=change['vector_signature']
        if sig[0]=='UV' and sig[1]!='_u0':uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map=sig[1];tree.links.new(uv.outputs[0],tex.inputs['Vector'])
        elif sig[0]!='UV':raise ValueError('nontrivial baked colour UV requires transport')
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_animations=False,export_skins=False,export_extras=True,export_yup=True,export_image_format='AUTO',export_normals=True,export_tangents=True,export_texcoords=True,export_materials='EXPORT')
    tangent_repair=repair_tangents(glb)
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));imported=[o for o in bpy.context.scene.objects if o.type=='MESH'];bpy.context.view_layer.update();assert len(imported)==len(meshes)
    glbbounds=[list(v) for v in bounds(imported)];err=max(abs(nativebounds[k][j]-glbbounds[k][j]) for k in range(2) for j in range(3));assert err<max(.0001,span*.00005),('GLB positions changed',err)
    assert sum(len(p.vertices)-2 for o in imported for p in o.data.polygons)==triangles
    setup_preview(imported);bpy.context.scene.render.filepath=str(poster)
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
        for d in prefs.devices:d.use=d.type=='METAL'
        if any(d.type=='METAL' for d in prefs.devices):bpy.context.scene.cycles.device='GPU'
    except Exception:pass
    bpy.ops.render.render(write_still=True)
    subprocess.run([PYTHON,'-c',"from PIL import Image;import sys,json;from pathlib import Path;im=Image.open(sys.argv[1]).convert('RGBA');count=sum(im.getchannel('A').histogram()[5:]);assert count>100 or sys.argv[3]=='scenes';Path(sys.argv[2]).with_name('preview-metrics.json').write_text(json.dumps(dict(visible_pixels=count,source_component_only=sys.argv[3]=='scenes')));bg=Image.new('RGBA',im.size,(25,25,25,255));bg.alpha_composite(im);bg.convert('RGB').save(sys.argv[2],format='WEBP',quality=90,method=6)",str(poster),str(webp),modelmeta['category']],check=True)
    bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False);assert all(im.packed_file for im in bpy.data.images if im.type=='IMAGE')
    for n,v in native_geometry.items():
        ob=bpy.data.objects.get(n);assert ob and ob.type=='MESH'
        assert len(ob.data.vertices)==v['vertices'] and len(ob.data.polygons)==v['polygons']
        assert [x.name for x in ob.data.uv_layers]==v['uv_layers']
    reopened_bounds=[list(v) for v in bounds([bpy.data.objects[n] for n in native_geometry])]
    assert max(abs(nativebounds[k][j]-reopened_bounds[k][j]) for k in range(2) for j in range(3))<1e-6
    result=dict(ok=True,version=VERSION,id=ident,name=name,section=modelmeta['category'],source=row['source_path'],source_sha256=row['source_sha256'],textures=texdetails,inactive_missing_textures=inactive_missing,material_changes=changes,special_materials=special,native_geometry=native_geometry,triangles=triangles,native_bounds=nativebounds,glb_bounds=glbbounds,max_position_error=err,tangent_repair=tangent_repair,blend_editable_rig=True,glb_pose_baked=True,preview_metrics=json.loads((folder/'preview-metrics.json').read_text()),seconds=time.time()-started)
    for key,p in [('blend',blend),('glb',glb),('poster',poster),('webp',webp)]:result[key]=str(p);result[key+'Bytes']=p.stat().st_size;result[key+'Sha256']=sha(p)
    tmp=reportpath.with_suffix('.export-tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,indent=1));tmp.replace(reportpath);(folder/'failure.json').unlink(missing_ok=True);print('EXPORTED',ident,result['blendBytes'],result['glbBytes'],round(result['seconds'],1),flush=True)

args=sys.argv[sys.argv.index('--')+1:];records=json.loads((OUT/'state/raiders-model-index.json').read_text())
if '--include-fragments' not in args:
    actor_plans=json.loads((OUT/'reports/raiders/actor-assemblies.json').read_text())
    confirmed_sources={m['source'] for a in actor_plans for m in a['models'] if 'error' not in m}
    records=[r for r in records if r['source'] in confirmed_sources or any(m['category']=='weapons' for m in r['models'])]
if '--name' in args:
    wanted=args[args.index('--name')+1];records=[r for r in records if any(m['name']==wanted for m in r['models'])]
elif '--sources-json' in args:
    wanted=set(json.loads(Path(args[args.index('--sources-json')+1]).read_text()));records=[r for r in records if r['source'] in wanted]
elif '--category' in args:
    cat=args[args.index('--category')+1];records=[r for r in records if any(m['category']==cat for m in r['models'])]
if '--limit' in args:records=records[:int(args[args.index('--limit')+1])]
for row in records:
    import shutil
    if shutil.disk_usage(OUT).free<6*1024**3:print('STOP_STORAGE_GUARD',flush=True);break
    try:run(row['record'])
    except Exception as e:
        path=OUT/'state'/('export-error-'+Path(row['record']).name);path.write_text(json.dumps(dict(record=row['record'],error=str(e),traceback=traceback.format_exc()),ensure_ascii=False,indent=1));traceback.print_exc();print('EXPORT_FAILED',row['source'],str(e),flush=True)
    gc.collect()
