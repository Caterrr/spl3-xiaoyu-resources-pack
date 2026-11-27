"""Describe native Blender shader edits against a verified 4.5 project.

Insert one MixRGB node between the original albedo and the Principled BSDF.
Its factor is the existing game paint mask, its second colour the user's ink.
Only node/link DATA records are added; all source images and mesh data stay in place.
"""
import base64
import struct
import zstandard


def field_offset(structure, path):
    offset = 0
    for key in path.split("."):
        field = structure.field_from_name[key.encode()]
        offset += field.dna_offset
        structure = field.dna_type
    return offset


def linked_list(file, block, name):
    row = file.find_block_from_offset(block.get((name, b"first")))
    while row:
        yield row
        row = row.get_pointer(b"next")


class PaintGraph:
    def __init__(self, file):
        assert file.header.version == 405 and file.block_header_struct.size == 24
        self.file = file
        self.edits = []
        self.address = max(b.addr_old + b.size for b in file.blocks) + 4096
        self.materials = {b.get((b"id", b"name"))[2:]: b for b in file.find_blocks_from_code(b"MA")}

    def apply(self, material, bsdf, mask):
        tree = self.materials[material].get_pointer(b"nodetree")
        nodes = {b.get(b"name"): b for b in linked_list(self.file,tree,b"nodes")}
        shader = nodes[bsdf]
        texture = nodes[mask]
        base = next(s for s in linked_list(self.file,shader,b"inputs") if s.get(b"identifier") == "Base Color")
        color = next(s for s in linked_list(self.file,texture,b"outputs") if s.get(b"identifier") == "Color")
        records = []
        edit = self.edits
        file = self.file

        def record(kind):
            index = file.sdna_index_from_id[kind.encode()]
            dna = file.structs[index]
            data = bytearray(dna.size)
            address = self.address
            self.address += (dna.size + 15) & ~7
            records.append((address, index, data))
            return address, dna, data

        def put(row, key, fmt, *values):
            if isinstance(row, tuple):
                _, dna, buf = row
                struct.pack_into("<"+fmt, buf, field_offset(dna,key), *values)
            else:
                pos = row.file_offset + field_offset(row.dna_type,key)
                data = struct.pack("<"+fmt,*values)
                edit.append((pos,len(data),data,None))

        def pointer(row,key,value):
            put(row,key,"Q",value)

        def append_list(owner, field, old_last, new):
            pointer(old_last, "next", new[0][0])
            pointer(new[0], "prev", old_last.addr_old)
            pointer(owner, field+".last", new[-1][0])
            for left,right in zip(new,new[1:]):
                pointer(left,"next",right[0])
                pointer(right,"prev",left[0])

        mix = record("bNode")
        put(mix,"name","64s",b"InkSurface")
        put(mix,"label","64s",b"Ink surface")
        put(mix,"idname","64s",b"ShaderNodeMixRGB")
        identifier = max(b.get(b"identifier") for b in nodes.values())
        used={b.get(b"identifier") for b in nodes.values()}
        identifier = (identifier + 1) % 2147483647 or 1
        while identifier in used: identifier += 1
        put(mix,"identifier","i",identifier)
        put(mix,"type","h",103)  # SH_NODE_MIX_RGB, operation MIX
        put(mix,"width","f",150)
        put(mix,"height","f",100)
        x,y=shader.get(b"location")
        put(mix,"location","2f",x-200,y+180)
        put(mix,"locx","f",x-200)
        put(mix,"locy","f",y+180)
        last_node=file.find_block_from_offset(tree.get((b"nodes",b"last")))
        append_list(tree,"nodes",last_node,[mix])

        def socket(name, scalar=False, output=False):
            sock=record("bNodeSocket")
            put(sock,"name","64s",name.encode())
            put(sock,"identifier","64s",name.encode())
            put(sock,"idname","64s",b"NodeSocketFloatFactor" if scalar else b"NodeSocketColor")
            put(sock,"type","h",0 if scalar else 2)
            put(sock,"limit","h",4095 if output else 1)
            put(sock,"in_out","h",2 if output else 1)
            val=record("bNodeSocketValueFloat" if scalar else "bNodeSocketValueRGBA")
            pointer(sock,"default_value",val[0])
            if scalar:
                put(val,"value","f",1);put(val,"max","f",1)
            return sock,val

        fac,_=socket("Fac",True)
        under,under_val=socket("Color1")
        ink,ink_val=socket("Color2")
        out,_=socket("Color",output=True)
        put(under_val,"value","4f",*base.get_pointer(b"default_value").get(b"value"))
        put(ink_val,"value","4f",1,.10946171,.011612245,1)
        for left,right in [(fac,under),(under,ink)]:
            pointer(left,"next",right[0]);pointer(right,"prev",left[0])
        pointer(mix,"inputs.first",fac[0]);pointer(mix,"inputs.last",ink[0])
        pointer(mix,"outputs.first",out[0]);pointer(mix,"outputs.last",out[0])
        original_link=base.get_pointer(b"link")
        if original_link:
            pointer(original_link,"tonode",mix[0]);pointer(original_link,"tosock",under[0])
            pointer(under,"link",original_link.addr_old)
        def new_link(fromnode,fromsock,tonode,tosock):
            link=record("bNodeLink")
            for key,addr in [('fromnode',fromnode),('fromsock',fromsock),('tonode',tonode),('tosock',tosock)]:
                pointer(link,key,addr)
            put(link,"flag","i",2)
            return link
        mask_link=new_link(texture.addr_old,color.addr_old,mix[0],fac[0])
        finish=new_link(mix[0],out[0],shader.addr_old,base.addr_old)
        pointer(fac,"link",mask_link[0]);pointer(base,"link",finish[0])
        last_link=file.find_block_from_offset(tree.get((b"links",b"last")))
        append_list(tree,"links",last_link,[mask_link,finish])
        at=tree.file_offset+tree.size
        buf=bytearray();tint=None
        for addr,index,data in records:
            buf+=file.block_header_struct.pack(b"DATA",len(data),addr,index,1)
            if addr==ink_val[0]:tint=len(buf)+field_offset(ink_val[1],"value")
            buf+=data
        assert tint is not None
        edit.append((at,0,buf,tint))

    def encode(self):
        raw=bytearray()
        end=0
        for at,remove,data,tint in sorted(self.edits,key=lambda x:(x[0],x[1])):
            assert at>=end
            raw+=struct.pack("<4I",at,remove,len(data),0xffffffff if tint is None else tint)
            raw+=data
            end=at+remove
        return base64.b64encode(zstandard.ZstdCompressor(level=9).compress(raw)).decode()
