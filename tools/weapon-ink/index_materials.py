"""Index the editable team-colour nodes in matching Blender and GLB deliveries.

Run in Blender with -- input.json output.json path/to/blendfile.py.
Input rows contain id, blendSha256, glbSha256, and local blend and glb paths.
The blendfile reader is Blender's SDNA reader from io_blend_utils.
"""
import importlib.util
import json
import struct
import sys
from hashlib import sha256
from pathlib import Path

import bpy
import numpy as np

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
    materials = [m for m in bpy.data.materials
                 if m.node_tree and m.node_tree.nodes.get("ResourcePack_TeamColor")]
    if not materials:
        return None
    json_size = struct.unpack_from("<I", glb, 12)[0]
    doc = json.loads(glb[20:20 + json_size])
    gltf_names = {m["name"]: i for i, m in enumerate(doc["materials"])}
    offsets = []
    with blendfile.open_blend(str(native)) as file:
        file.handle.seek(0)
        raw = file.handle.read()
        for block in file.blocks:
            if block.dna_type_name != "bNode" or block.get(b"name") != "ResourcePack_TeamColor":
                continue
            socket = file.find_block_from_offset(block.get((b"outputs", b"first")))
            value = socket.get_pointer(b"default_value")
            offset, count = value.get_file_offset(b"value")
            assert value.dna_type_name == "bNodeSocketValueRGBA" and count == 4
            assert np.allclose(value.get(b"value"), [1, .1094617, .0116122, 1], atol=1e-6)
            offsets.append(offset)
    assert len(offsets) >= len(materials)
    images, targets = [], []

    def source_input(socket):
        if not socket.is_linked:
            return {"rgb": list(socket.default_value)[:3]}
        node = socket.links[0].from_node
        assert node.type == "TEX_IMAGE" and node.image.packed_file
        data = node.image.packed_file.data
        offset = raw.find(data)
        assert offset >= 0 and data.startswith(b"\x89PNG") and data[24] == 8 and data[28] == 0
        image = [offset, len(data), node.extension == "REPEAT"]
        if image not in images:
            images.append(image)
        return images.index(image)

    for material in materials:
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
    if targets:
        return dict(blend=row["blendSha256"], glb=row["glbSha256"], offsets=offsets,
                    images=images, materials=targets)


profiles = {}
for row in json.loads(source.read_text()):
    profile = index_model(row)
    if profile:
        profiles[row["id"]] = profile
destination.write_text(json.dumps(profiles, separators=(",", ":")) + "\n")
