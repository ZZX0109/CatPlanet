"""Seat the supplementary ear-tip fibres onto the authored ear surface."""
import bpy
from mathutils.bvhtree import BVHTree

body=bpy.data.objects['MaineCoon_Body']
bpy.context.view_layer.update()
surface=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
for obj in bpy.data.objects:
    if not obj.name.startswith('Maine Lynx Tip'):continue
    inverse=obj.matrix_world.inverted()
    for index in range(0,len(obj.data.points),4):
        root=obj.matrix_world@obj.data.points[index].position
        hit=surface.find_nearest(root)
        target=hit[0]+hit[1]*.00003
        delta=inverse@target-obj.data.points[index].position
        for step in range(4):obj.data.points[index+step].position+=delta
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('EAR_TUFT_ROOTS_SEATED',flush=True)
