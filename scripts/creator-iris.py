"""Deterministic radial iris pigmentation for the native Blender eye material.

This is an authored procedural texture, not a photograph or baked reflection.
Run through build-structural-cat.py inside Blender (bpy and numpy required).
"""
from pathlib import Path
import bpy
import numpy as np


def make_iris_texture(directory: Path, size: int = 1024, detailed=False):
    axis=(np.arange(size,dtype=np.float32)+.5)/size*2-1
    x,y=np.meshgrid(axis,axis)
    radius=np.sqrt(x*x+y*y)
    angle=np.arctan2(y,x)
    # Fibres keep a mainly radial direction with small, repeatable stromal waves.
    flow=angle+.012*np.sin(radius*28+angle*9)+.006*np.sin(radius*71-angle*5)
    coarse=np.sin(flow*173+radius*16+.8*np.sin(flow*31))
    fine=np.sin(flow*397-radius*22+.6*np.sin(flow*53))
    fine2=np.sin(flow*631+radius*33)
    crypts=np.maximum(0,np.sin(flow*47+radius*19))**9
    flecks=np.sin(angle*91+radius*137)*np.sin(angle*157-radius*83)
    inner=np.array([.54,.43,.22],dtype=np.float32)
    outer=np.array([.30,.43,.25],dtype=np.float32)
    if detailed:
        inner=np.array([.46,.36,.14],dtype=np.float32)
        outer=np.array([.22,.34,.16],dtype=np.float32)
    mix=np.clip((radius-.20)/.66,0,1)[...,None]
    rgb=inner*(1-mix)+outer*mix
    fibres=.055*coarse+.028*fine+.012*fine2-.035*crypts+.015*flecks
    if detailed:
        fibres*=1.6
        fibres+=.015*np.sin(angle*23+radius*37)*np.sin(angle*41-radius*13)
    rgb += fibres[...,None]*np.array([.8,1,.65],dtype=np.float32)
    # The limbal ring is actual dark pigment, never a painted catchlight.
    ring=np.clip((radius-.86)/.12,0,1)
    ring=ring*ring*(3-2*ring)
    rgb *= (1-.64*ring)[...,None]
    rgb *= (1-.08*np.sin(radius*38+angle*3)**2)[...,None]
    rgba=np.ones((size,size,4),dtype=np.float32)
    rgba[:,:,:3]=np.clip(rgb,.025,.85)
    image=bpy.data.images.new('Authored radial iris fibres',width=size,height=size,alpha=True)
    image.colorspace_settings.name='sRGB'
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw=str(directory/'iris-radial.png')
    image.file_format='PNG'
    image.save()
    image.pack()
    return image
