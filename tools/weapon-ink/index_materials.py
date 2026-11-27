"""Index the editable team-colour nodes in matching Blender and GLB deliveries.

Run in Blender with -- input.json output.json path/to/blendfile.py.
Input rows contain id, blendSha256, glbSha256, and local blend and glb paths.
The blendfile reader is Blender's SDNA reader from io_blend_utils.
"""
import importlib.util
import json
import re
import struct
import sys
from hashlib import sha256
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paint_graph import PaintGraph, linked_list

source, destination, reader = map(Path, sys.argv[sys.argv.index("--") + 1:])
spec = importlib.util.spec_from_file_location("blendfile", reader)
blendfile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(blendfile)


def index_model(row):
    native = Path(row["blend"])
    glb = Path(row["glb"]).read_bytes()
    if (sha256(native.read_bytes()).hexdigest() != row["blendSha256"] or
            sha256(glb).hexdigest() != row["glbSha256"]):
        raise ValueError(f'File version mismatch for {row["id"]}')

    bpy.ops.wm.open_mainfile(filepath=str(native.resolve()), load_ui=False)
    json_size = struct.unpack_from("<I", glb, 12)[0]
    doc = json.loads(glb[20:20 + json_size])
    gltf_names = {m["name"]: i for i, m in enumerate(doc["materials"])}
    materials = [m for m in bpy.data.materials if m.node_tree]
    roller = "Wmn_Roller_" in row["id"] and "Brush" not in row["id"]
    brush = "Wmn_Brush_" in row["id"] or "Wmn_Roller_Brush" in row["id"]
    paint_nodes = {}
    # Only meshes with the game's separate ink-bearing surface use the paint shader.
    stamp = "Wmn_Saber_" in row["id"] and any("_M_Stamp" in m.name for m in materials)
    marker = "Wsb_LineMarker-" in row["id"]
    if roller or brush or stamp or marker:
        for mat in materials:
            if stamp and "_M_Stamp" not in mat.name:
                continue
            if mat.get("SO_blitz_paint_type") != "4":
                continue
            candidates = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                          and n.label.split(" ")[0] == "_cp0"
                          and re.search(r"_2cl(?:\.\d+)?$", n.image.name, re.I)]
            if len(candidates) != 1:
                continue
            node = candidates[0]
            assert not node.inputs["Vector"].is_linked and node.interpolation == "Linear"
            assert node.image.colorspace_settings.name == "Non-Color"
            values = np.empty(len(node.image.pixels), dtype=np.float32)
            node.image.pixels.foreach_get(values)
            channels = values.reshape(-1, 4)
            assert np.array_equal(channels[:,0], channels[:,1]) and np.array_equal(channels[:,0], channels[:,2])
            if channels[:,0].any():
                paint_nodes[mat.name] = node
        if roller:
            materials = [m for m in materials if re.search(r"_M_(?:Custom)?Roll(?:[A-F])?(?:_|\.|$)",m.name,re.I)]
        elif any(re.search(r"_M_Brush", n, re.I) for n in paint_nodes):
            materials = [m for m in materials if re.search(r"_M_Brush",m.name,re.I)]
    paint_nodes = {m.name:paint_nodes[m.name] for m in materials if m.name in paint_nodes}
    # Keep the original team trim outside the ink mask. Shared atlases on brushes
    # contain both the grip and bristles and must retain the baked grip colour.
    # A retracted Stamper covers its ink pads. Keep its original exterior team
    # accents in sync as well, so choosing a colour is visible in the rest pose.
    legacy = [m for m in materials if m.node_tree.nodes.get("ResourcePack_TeamColor")
              and (not paint_nodes or (stamp and m.name not in paint_nodes))]
    if not legacy and not paint_nodes:
        return None
    native_graph = None
    offsets = []
    with blendfile.open_blend(str(native)) as file:
        file.handle.seek(0)
        raw = file.handle.read()
        native_mats = {m.get((b"id", b"name"))[2:]:m for m in file.find_blocks_from_code(b"MA")}
        for mat in legacy:
            tree = native_mats[mat.name].get_pointer(b"nodetree")
            node = next(b for b in linked_list(file,tree,b"nodes") if b.get(b"name") == "ResourcePack_TeamColor")
            socket = next(linked_list(file,node,b"outputs"))
            value = socket.get_pointer(b"default_value")
            offset, count = value.get_file_offset(b"value")
            assert value.dna_type_name == "bNodeSocketValueRGBA" and count == 4
            assert np.allclose(value.get(b"value"), [1,.1094617,.0116122,1], atol=1e-6)
            offsets.append(offset)
        if paint_nodes:
            graph = PaintGraph(file)
            for name,node in paint_nodes.items():
                bsdf = next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                graph.apply(name,bsdf.name,node.name)
            native_graph = graph.encode()
    images, targets = [], []

    def source_input(socket):
        if not socket.is_linked:
            return {"rgb": list(socket.default_value)[:3]}
        node = socket.links[0].from_node
        return image_ref(node)

    def image_ref(node):
        assert node.type == "TEX_IMAGE" and node.image.packed_file
        data = node.image.packed_file.data
        offset = raw.find(data)
        assert offset >= 0 and data.startswith(b"\x89PNG") and data[24] == 8 and data[28] == 0
        image = [offset, len(data), node.extension == "REPEAT"]
        if image not in images:
            images.append(image)
        return images.index(image)

    for material in legacy:
        if material.name not in gltf_names:
            continue
        index = gltf_names[material.name]
        bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        node = bsdf.inputs["Base Color"].links[0].from_node
        target = {"material": index}
        if node.name == "ResourcePack_AO":
            target["ao"] = source_input(node.inputs[2])
            node = node.inputs[1].links[0].from_node
        if node.name == "ResourcePack_TeamMask":
            assert node.inputs[2].links[0].from_node.name == "ResourcePack_TeamColor"
            mask = node.inputs[0].links[0].from_node.image
            pixels = np.empty(len(mask.pixels), dtype=np.float32)
            mask.pixels.foreach_get(pixels)
            if not pixels[::4].any():
                continue
            target["base"] = source_input(node.inputs[1])
            target["mask"] = source_input(node.inputs[0])
        else:
            assert node.name == "ResourcePack_TeamColor", node.name
        assert "baseColorTexture" in doc["materials"][index]["pbrMetallicRoughness"]
        targets.append(target)
    result = dict(blend=row["blendSha256"], glb=row["glbSha256"], offsets=sorted(offsets),
                  images=images, materials=targets)
    paint = []
    for name,node in paint_nodes.items():
        if name not in gltf_names:
            continue
        index = gltf_names[name]
        slot = doc["materials"][index]["pbrMetallicRoughness"].get("baseColorTexture",{})
        extensions = slot.get("extensions", {})
        transform = extensions.get("KHR_texture_transform", {})
        assert set(extensions) <= {"KHR_texture_transform"}
        assert transform.get("texCoord", slot.get("texCoord", 0)) == 0 and not transform.get("rotation")
        assert all(v >= 1 and int(v) == v for v in transform.get("scale", [1, 1]))
        if "index" in slot:
            texture = doc["textures"][slot["index"]]
            wrap = doc["samplers"][texture["sampler"]] if "sampler" in texture else {}
            assert all(wrap.get(k, 10497) in (10497, 33071) for k in ("wrapS", "wrapT"))
        paint.append({"material":index,"mask":image_ref(node)})
    if paint:
        result.update(paint=paint, graph=native_graph)
    if targets or paint:
        return result


profiles = {}
for row in json.loads(source.read_text()):
    profile = index_model(row)
    if profile:
        profiles[row["id"]] = profile
destination.write_text(json.dumps(profiles, separators=(",", ":")) + "\n")
