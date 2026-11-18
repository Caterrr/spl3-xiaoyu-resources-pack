"""Build same-hairstyle fit data from the canonical GLBs in the asset manifest.

Run in Blender background mode with the release's asset-paths.json:
  blender -b -P tools/spl3-headgear/generate-fit.py -- ASSET_PATHS [--report REPORT]
"""
import argparse
import base64
from collections import Counter
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import struct
import sys

from mathutils import Vector
from mathutils.bvhtree import BVHTree
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
# These head-mounted accessories can move slightly clear of the hair without
# pulling the contact points of glasses, masks or ear accessories off the face.
VISORS = {"Hed_COP111", "Hed_VIS003", "Hed_VIS005", "Hed_VIS006", "Hed_HBD005"}
SEALED_VISORS = {"Hed_COP113"}
OPEN_FRAMES = {"Hed_EYE011", "Hed_EYE024", "Hed_EYE025", "Hed_EYE027",
               "Hed_EYE031", "Hed_HAP026", "Hed_HAP027"}
OFFSET_DIRECTIONS = {
    "Hed_AMB021": ((0, 1, 0),),
    "Hed_HAP014": ((0, 1, 0),),
    "Hed_HAP038": ((-1, 0, 0), (-0.8, 0.6, 0), (-0.8, 0, 0.6)),
}


def load_primitives(entry, paths):
    content = Path(paths[entry["url"]]).read_bytes()
    if hashlib.sha256(content).hexdigest() != entry["sha256"]:
        raise ValueError(f"Asset hash mismatch: {entry['source']}")
    json_length = struct.unpack_from("<I", content, 12)[0]
    document = json.loads(content[20:20 + json_length])
    binary_offset = 28 + json_length

    def accessor(index, width):
        spec = document["accessors"][index]
        view = document["bufferViews"][spec["bufferView"]]
        dtype = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[spec["componentType"]])
        offset = binary_offset + view.get("byteOffset", 0) + spec.get("byteOffset", 0)
        stride = view.get("byteStride", dtype.itemsize * width)
        return np.ndarray((spec["count"], width), dtype=dtype, buffer=content,
                          offset=offset, strides=(stride, dtype.itemsize))

    primitives = {}
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        # For these skinned meshes the canonical bind-space positions are also
        # their world-space positions at rest. Reject other asset structures.
        if "skin" not in node or set(node) & {"matrix", "translation", "rotation", "scale"}:
            raise ValueError(f"Unexpected mesh transform: {node['name']}")
        for index, primitive in enumerate(document["meshes"][node["mesh"]]["primitives"]):
            if primitive.get("mode", 4) != 4:
                raise ValueError(f"Expected triangle mesh: {node['name']}")
            positions = accessor(primitive["attributes"]["POSITION"], 3)
            faces = accessor(primitive["indices"], 1).reshape(-1, 3)
            material = document["materials"][primitive["material"]]
            key = f"{node['mesh']}:{index}"
            if key in primitives:
                raise ValueError(f"Instanced mesh: {node['name']}")
            primitives[key] = (positions, faces, material.get("alphaMode") == "BLEND")
    return primitives


def tree(primitives, offset=(0, 0, 0), width=1, shell_only=False):
    points, faces = [], []
    for positions, triangles, blended in primitives.values():
        if shell_only and blended:
            continue
        faces.extend(tuple(index + len(points) for index in face) for face in triangles.tolist())
        points.extend((positions * (width, 1, width) + offset).tolist())
    return BVHTree.FromPolygons(points, faces, all_triangles=True) if faces else None


def overlaps(gear, hair):
    return {index for _, index in gear.overlap(hair)}


def covered_faces(gear, positions, faces, minimum_height, sealed_visor):
    # Cast from inside the crown toward the hair. If the shell is encountered
    # first, hair on that ray would stick through the outside of the helmet.
    depths = (0, .039, -.039) if sealed_visor else (0,)
    origins = [Vector((0, 1.48, z)) for z in depths]
    centers = positions[faces].mean(axis=1)
    for index, (x, y, z) in enumerate(centers):
        if y < minimum_height:
            continue
        point = Vector((x, y, z))
        for origin in origins:
            direction = point - origin
            distance = direction.length
            if distance <= .002:
                continue
            _, _, _, hit = gear.ray_cast(origin, direction / distance, distance - .002)
            if hit is not None:
                yield index
                break


def encode_removed(faces, removed):
    if not removed:
        return None
    if len(removed) == len(faces):
        return [len(faces), None]
    mask = bytearray(max(removed) // 8 + 1)
    for index in removed:
        mask[index // 8] |= 1 << (index % 8)
    return [len(faces), base64.b64encode(mask).decode("ascii")]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("asset_paths", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    paths = json.loads(args.asset_paths.read_text())
    catalog = json.loads((ROOT / "src/catalog/spl3/customizer.json").read_text())
    assets = {asset["sha256"]: asset for kind in ("hair", "headgear")
              for entry in catalog[kind] for asset in entry.get("variants", {}).values()}

    @lru_cache(None)
    def primitives(sha):
        return load_primitives(assets[sha], paths)

    @lru_cache(None)
    def full_tree(sha, offset=(0, 0, 0), width=1, shell_only=False):
        return tree(primitives(sha), offset, width, shell_only)

    @lru_cache(None)
    def hair_trees(sha):
        return {key: tree({key: primitive}) for key, primitive in primitives(sha).items()}

    def fit(gear, hair, cover):
        gear_sha, hair_sha = gear["sha256"], hair["sha256"]
        hair_meshes = hair_trees(hair_sha)
        source = gear["source"]
        gear_tree = full_tree(gear_sha)
        original = {key: overlaps(gear_tree, mesh) for key, mesh in hair_meshes.items()}
        collision_count = sum(map(len, original.values()))
        remaining = original
        offset, width = (0, 0, 0), 1
        best_count = collision_count

        trials = [
            (tuple(round(distance * component, 4) for component in direction), 1)
            for distance in (.01, .02, .03, .04, .06)
            for direction in OFFSET_DIRECTIONS.get(source, ())
        ]
        if source in VISORS:
            trials.extend(((0, rise, 0), scale)
                          for scale in (1.02, 1.04, 1.06, 1.09, 1.12)
                          for rise in (0, .01, .02, .035))
        if source in OPEN_FRAMES:
            trials.extend(((0, 0, 0), scale) for scale in (1.01, 1.02, 1.03, 1.045, 1.06))
        for shift, scale in trials:
            if best_count == 0:
                break
            adjusted = full_tree(gear_sha, shift, scale)
            found = {key: overlaps(adjusted, mesh) for key, mesh in hair_meshes.items()}
            count = sum(map(len, found.values()))
            if count < best_count:
                offset, width, remaining, best_count = shift, scale, found, count

        if source in OPEN_FRAMES:
            # Thin temples can disappear naturally behind individual strands.
            # Widen the frame a little when it helps, keeping the hair surface intact.
            faces = sum(len(triangles) for _, triangles, _ in primitives(hair_sha).values())
            return ({"width": width} if width != 1 else {}), [collision_count, 0, faces]

        sealed_visor = source in SEALED_VISORS
        cap = source.startswith("Hed_CAP")
        shell = full_tree(gear_sha, shell_only=not sealed_visor) if cover or cap else None
        # Caps cover the crown, while loose hair below the brim should keep its length.
        minimum_height = 1.52 if cap else 1.19
        masks = {}
        removed_count = 0
        face_count = 0
        for key, (positions, faces, _) in primitives(hair_sha).items():
            removed = set(remaining[key])
            if shell:
                removed.update(covered_faces(shell, positions, faces, minimum_height, sealed_visor))
            face_count += len(faces)
            encoded = encode_removed(faces, removed)
            if encoded:
                masks[key] = encoded
                removed_count += len(removed)
        result = {}
        if any(offset):
            result["offset"] = offset
        if width != 1:
            result["width"] = width
        if masks:
            result["masks"] = masks
        return result, [collision_count, removed_count, face_count]

    data, report, checked = {}, {}, {}
    approved_count = 0
    for avatar in catalog["avatars"]:
        gender, species = avatar["gender"], avatar["species"]
        for item in catalog["headgear"]:
            gear = item.get("variants", {}).get(gender)
            rule = item.get("fitByAvatar", {}).get(avatar["id"])
            if not gear or not rule:
                continue
            for entry in catalog["hair"]:
                hair = entry["variants"].get(gender)
                if entry["species"] != species or not hair:
                    continue
                key = (gear["sha256"], hair["sha256"])
                cover = bool(rule.get("hideHair"))
                prefix = "spl3:Har_OCT" if species == "octopus" else "spl3:Har_SQD"
                allowed = rule.get("hair", [style for style in item.get("compatibleHair", {}).get(gender, [])
                                            if style.startswith(prefix)])
                approved = not cover and entry["id"] in allowed
                mode = (cover, approved)
                if key in checked:
                    if checked[key] != mode:
                        raise ValueError(f"Different fit rules for {key}")
                    continue
                checked[key] = mode
                if approved:
                    approved_count += 1
                    continue
                result, stats = fit(gear, hair, cover)
                if result:
                    data.setdefault(key[0][:16], {})[key[1][:16]] = result
                report[f'{gear["source"]}/{hair["source"]}'] = {
                    "closed": cover, "faces": stats, "offset": result.get("offset"), "width": result.get("width"),
                }

    code = "// Generated by tools/spl3-headgear/generate-fit.py.\nexport default "
    (ROOT / "src/customizer-spl3-headgear-fit-data.js").write_text(
        code + json.dumps(data, separators=(",", ":"), sort_keys=True) + ";\n"
    )
    if args.report:
        args.report.write_text(json.dumps(report, indent=1))
    print({"pairs": len(checked), "already_fitted": approved_count, "adjustments": sum(map(len, data.values())),
           "mask_counts": Counter(bool(record["faces"][1]) for record in report.values())})


if __name__ == "__main__":
    main()
