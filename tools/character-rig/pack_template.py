"""Gzip a Blender template for static hosting after clearing local file-browser paths."""
import gzip
import struct
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
data = bytearray(source.read_bytes())
assert data[:12] == b'BLENDER-v405'
position = 12
while position < len(data):
    code, size, _, _, _ = struct.unpack_from('<4sIQII', data, position)
    begin = position + 24
    # Blender's factory workspace stores the file browser's last directory.
    for prefix in (b'/Users/', b'/home/'):
        cursor = data.find(prefix, begin, begin + size)
        while cursor >= 0:
            end = data.index(0, cursor, begin + size)
            data[cursor:end] = b'//'.ljust(end-cursor, b'\0')
            cursor = data.find(prefix, end, begin + size)
    position = begin + size
target.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
