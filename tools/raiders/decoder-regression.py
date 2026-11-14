from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent.parent
prior=root/'角色搭配_20261114.nosync'
scope={'__file__':str(prior/'prepare_assets.py')}
exec(compile((prior/'prepare_assets.py').read_text().split('\njobs=',1)[0],str(prior/'prepare_assets.py'),'exec'),scope)
H=scope['H'];out=Path(__file__).resolve().parent
reports=[]
def poison(*args):raise AssertionError('Leaked decoder selected')
for row in json.loads((out/'decode-comparison.json').read_text()):
 if row['mode']!='current':continue
 src=Path(row['source'])
 H['brti'].deswizzle=poison
 imgs,details=H['import_texture'](src,'Regression_',normal=row['normal_xy_reconstructed'])
 assert H['brti'].deswizzle is poison,'Decoder was not restored'
 actual=scope['png_bytes'](scope['fix']['pixels'](next(iter(imgs.values())),linear=False),False)
 expected=(out/(src.name+'-current.png')).read_bytes()
 assert actual==expected,(src.name,'decoder changed pixels')
 assert actual!=(out/(src.name+'-nx.png')).read_bytes()
 reports.append({'source':src.name,'sha256':hashlib.sha256(actual).hexdigest(),'isolated':True})
(out/'decoder-regression.json').write_text(json.dumps(reports,indent=2))
print('DECODER_REGRESSION_OK',len(reports))
