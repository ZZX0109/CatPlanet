"""Native face refinements shared by both Blender foundation builders.

The original anatomical mesh and UVs remain. Eyelid closure is authored on the
actual skin rim, in front of the unchanged globe; endpoint correctives preserve
closure through face controls. Optical material is assigned to existing globes.
"""
import math
from collections import Counter, defaultdict, deque
import numpy as np
import bpy
from mathutils import Vector


def topology(mesh, points):
    """Weld only for analysis, retaining the source's actual UV/vertex indices."""
    representatives = {}
    wids = []
    for p in points:
        key = tuple(int(round(x*1e7)) for x in p)
        if key not in representatives:
            representatives[key] = len(representatives)
        wids.append(representatives[key])
    groups = [[]for _ in representatives]
    for i,w in enumerate(wids): groups[w].append(i)
    wpoints = np.array([points[ids[0]]for ids in groups])
    adjacency = [set()for _ in groups]
    counts = Counter()
    rawcounts = Counter()
    for poly in mesh.data.polygons:
        for a,b in poly.edge_keys:
            wa,wb=wids[a],wids[b]
            adjacency[wa].add(wb);adjacency[wb].add(wa)
            counts[tuple(sorted((wa,wb)))]+=1
            rawcounts[tuple(sorted((a,b)))]+=1
    seen=set();components=[]
    for a in range(len(groups)):
        if a in seen:continue
        stack=[a];ids=[]
        while stack:
            i=stack.pop()
            if i in seen:continue
            seen.add(i);ids.append(i);stack+=list(adjacency[i])
        components.append(ids)
    main=set(max(components,key=len))
    def loops(edges):
        adj=defaultdict(list)
        for a,b in edges:adj[a].append(b);adj[b].append(a)
        visited=set();out=[]
        for a in adj:
            if a in visited:continue
            stack=[a];ids=[]
            while stack:
                i=stack.pop()
                if i in visited:continue
                visited.add(i);ids.append(i);stack+=adj[i]
            out.append(ids)
        return out
    welded_loops=loops([e for e,n in counts.items()if n==1 and e[0]in main])
    raw_loops=loops([e for e,n in rawcounts.items()if n==1 and wids[e[0]]in main])
    return wids,groups,wpoints,adjacency,main,welded_loops,raw_loops,components


def remove_native_cards(mesh, points, head_weights, eye_ids, *, preserve_weights=None, report=None):
    """Clean detached facial whiskers without discarding the source ear coat.

    Small head-weighted components alone do not identify whiskers: the supplied
    Norwegian mesh also has hundreds of original ear-hair components. Its ear
    skin weights distinguish them from muzzle/brow whiskers. The caller supplies
    that source-specific mask; shared eyelid authoring does not guess bone names.
    """
    import bmesh
    t=topology(mesh,points)
    wids,groups,wpoints,adj,main,_,_,components=t
    protected={wids[int(i)]for ids in eye_ids for i in ids}
    bad=set();preserved=set();preserved_components=0;removed_components=0
    if preserve_weights is not None:
        preserve_weights=np.asarray(preserve_weights,dtype=float)
        if preserve_weights.shape != (len(points),) or not np.isfinite(preserve_weights).all():
            raise ValueError('Native coat preservation needs one finite weight per source vertex')
    for component in components:
        ids=[i for w in component for i in groups[w]]
        if len(ids)>60 or any(w in protected for w in component):continue
        p=points[ids]
        if np.mean(head_weights[ids])<.8:continue
        if np.ptp(p,axis=0).max()<.0025:continue
        # Retain near-globe skin/socket geometry irrespective of component size.
        if any(np.linalg.norm(p.mean(0)-points[e].mean(0))<.016 for e in eye_ids):continue
        if preserve_weights is not None and np.mean(preserve_weights[ids]) > .01:
            preserved.update(ids);preserved_components+=1;continue
        bad.update(ids)
        removed_components+=1
    count=sum(1 for p in mesh.data.polygons if all(i in bad for i in p.vertices))
    if report is not None:
        report.update({
            'method':'Preserve source small ear-weighted components before facial-whisker cleanup',
            'minimumMeanEarWeight':.01,
            'preservedEarComponents':preserved_components,
            'preservedEarVertices':len(preserved),
            'preservedEarFaces':sum(1 for p in mesh.data.polygons if all(i in preserved for i in p.vertices)),
            'removedWhiskerComponents':removed_components,
            'removedWhiskerFaces':count,
        })
    if count:
        original=points.copy()
        bm=bmesh.new();bm.from_mesh(mesh.data)
        bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
        faces=[face for face in bm.faces if all(v.index in bad for v in face.verts)]
        bmesh.ops.delete(bm,geom=faces,context='FACES_ONLY')
        bm.to_mesh(mesh.data);bm.free();mesh.data.update()
        after=np.array([tuple(v.co)for v in mesh.data.vertices])
        if not np.array_equal(original,after):raise RuntimeError('Card cleanup reordered source vertices')
    return count


def native_sphynx_closure(mesh,base,eye_ids):
    """Bake the source artist's own lid-bone action into neutral bind space."""
    scene=bpy.context.scene;rig=mesh.find_armature();action=rig.animation_data.action
    if not action:raise RuntimeError('Sphynx source lid animation unavailable')
    lid_names=[b.name for b in rig.pose.bones if any(token in b.name for token in ('EyeUpper','EyeLower','EyeSide'))]
    defaults={bone.name:bone.matrix_basis.copy()for bone in rig.pose.bones}
    curves={(fc.data_path,fc.array_index):fc for fc in action.fcurves}
    def upper_distance(side,frame):
        path='pose.bones["'+side+'EyeUpperSkinJnt"].location'
        return math.sqrt(sum((curves[(path,i)].evaluate(frame))**2 for i in range(3)))
    frames=np.linspace(float(action.frame_range[0]),float(action.frame_range[1]),300)
    distances=np.array([[upper_distance(side,float(frame))for side in ('Left','Right')]for frame in frames])
    normalized=distances/np.maximum(distances.max(0),1e-9)
    scores=normalized.min(1)+normalized.sum(1)*.25
    frame=float(frames[int(np.argmax(scores))])
    scene.frame_set(int(math.floor(frame)),subframe=frame-math.floor(frame));bpy.context.view_layer.update()
    authored={name:rig.pose.bones[name].matrix_basis.copy()for name in lid_names}
    scene.frame_set(1);rig.animation_data.action=None
    for name,matrix in defaults.items():rig.pose.bones[name].matrix_basis=matrix
    bpy.context.view_layer.update()
    basis_key=mesh.data.shape_keys.key_blocks[0]
    epsilon=float(np.ptp(base,axis=0).max()*.05)
    def evaluate(points):
        basis_key.data.foreach_set('co',points.astype(np.float32).ravel())
        mesh.data.vertices.foreach_set('co',points.astype(np.float32).ravel())
        mesh.data.shape_keys.update_tag();mesh.data.update();bpy.context.view_layer.update()
        deps=bpy.context.evaluated_depsgraph_get();deps.update()
        obj=mesh.evaluated_get(deps)
        return np.array([tuple(v.co)for v in obj.data.vertices])
    def affine_skin():
        origin=evaluate(base)
        matrix=np.empty((len(base),3,3))
        for axis in range(3):
            points=base.copy();points[:,axis]+=epsilon
            matrix[:,:,axis]=(evaluate(points)-origin)/epsilon
        evaluate(base)
        translation=origin-np.einsum('nij,nj->ni',matrix,base)
        return matrix,translation
    try:
        open_matrix,open_translation=affine_skin()
        for name,matrix in authored.items():rig.pose.bones[name].matrix_basis=matrix
        bpy.context.view_layer.update()
        closed_matrix,closed_translation=affine_skin()
        inverse=np.linalg.inv(open_matrix)
        transform=np.einsum('nij,njk->nik',inverse,closed_matrix)
        translation=np.einsum('nij,nj->ni',inverse,closed_translation-open_translation)
    finally:
        evaluate(base)
        for name,matrix in defaults.items():rig.pose.bones[name].matrix_basis=matrix
        rig.animation_data.action=action;scene.frame_set(1);bpy.context.view_layer.update()
    all_eye=np.array([int(i)for ids in eye_ids for i in ids],dtype=int)
    # Numerical differences from the sampled affine matrices are suppressed on
    # unaffected skin and on the original optical geometry.
    changed=np.max(np.abs(transform-np.eye(3)),axis=(1,2))+np.linalg.norm(translation,axis=1)>1e-4
    def close(points):
        result=np.einsum('nij,nj->ni',transform,points)+translation
        result[~changed]=points[~changed];result[all_eye]=points[all_eye]
        return result
    return close,{'sourceAction':action.name,'sourceBlinkFrame':frame,'lidBones':lid_names,'method':'Source-authored eyelid bone animation baked into bind-space skin morph; eyeballs unchanged'}


def smooth_np(a,b,values):
    t=np.clip((values-a)/(b-a),0,1)
    return t*t*(3-2*t)

def author_face_refinement(mesh, base, basis, origin, eye_ids, base_id, head_weight):
    """Return a report; add real Blink and appearance/closure corrective keys."""
    eye_sets=[set(map(int,ids))for ids in eye_ids]
    t=topology(mesh,base)
    wids,duplicates,wpoints,adjacency,main,weld_loops,raw_loops,components=t
    local=(base-np.array(origin))@basis.T
    models=[]
    all_eye=set().union(*eye_sets)
    for eye_index,ids in enumerate(eye_ids):
        ids=np.array(ids,dtype=int)
        center=local[ids].mean(0)
        # Existing UV seam rings delimit the source's anatomical lid margin.
        candidates=[]
        for ring in weld_loops:
            ring_ids=[duplicates[w][0]for w in ring]
            p=local[ring_ids]
            if 12<=len(ring)<=80:
                dist=np.linalg.norm(p.mean(0)-center)
                candidates.append((dist,list(ring)))
        for ring_ids in raw_loops:
            if not 18<=len(ring_ids)<=80:continue
            p=local[ring_ids]
            ring=list(dict.fromkeys(wids[i]for i in ring_ids))
            candidates.append((np.linalg.norm(p.mean(0)-center),ring))
        if not candidates:raise RuntimeError('No anatomical eyelid rim found')
        _,rim=min(candidates,key=lambda item:item[0])
        rim_ids=[duplicates[w][0]for w in rim]
        rim_points=local[rim_ids]
        # Reject a remote UV seam; unit derives from the real optical geometry.
        optical_size=np.ptp(local[ids],axis=0)
        unit=float(max(optical_size[0],optical_size[2]))
        if np.linalg.norm(rim_points.mean(0)-center)>unit*.7:
            raise RuntimeError('Eyelid loop does not surround the original eye')
        distances={w:0 for w in rim};q=deque(rim)
        while q:
            w=q.popleft()
            if distances[w]>=5:continue
            for neighbour in adjacency[w]:
                if neighbour in main and neighbour not in distances:
                    distances[neighbour]=distances[w]+1;q.append(neighbour)
        affected=[];blend=[]
        for w,distance in distances.items():
            for vertex in duplicates[w]:
                if vertex in all_eye:continue
                affected.append(vertex)
                blend.append([1,.82,.50,.23,.065,0][distance])
        if base_id=='sphynx':
            # Sphynx has a deep inner-socket opening as well as the visible outer
            # lid. Close the front-facing orbital skin, leaving its pink inner
            # lining behind rather than dragging that lining over the cornea.
            source_normals=np.array([tuple(v.normal)for v in mesh.data.vertices])@basis.T
            averaged=np.zeros_like(source_normals)
            for members in duplicates:
                averaged[members]=source_normals[members].mean(0)
            delta=local-center
            radial=np.sqrt((delta[:,0]/(unit*.52))**2+(delta[:,2]/(unit*.54))**2)
            mask=1-smooth_np(1.05,2.05,radial)
            mask*=smooth_np(-unit*.35,unit*.04,delta[:,1])
            mask*=np.array([1 if wids[i]in main and averaged[i,1]>-.08 else 0 for i in range(len(base))])
            mask[list(all_eye)]=0
            affected=np.where(mask>1e-5)[0].tolist()
            blend=mask[affected].tolist()
        models.append({'eye':ids,'rim':np.array(rim_ids), 'affected':np.array(affected), 'blend':np.array(blend), 'unit':unit})

    def close(points):
        coords=(points-np.array(origin))@basis.T
        result=coords.copy()
        for model in models:
            eye=coords[model['eye']]
            rim=coords[model['rim']]
            # Use an enclosing ellipsoid of the source globe (not a new eye).
            lo=eye.min(0);hi=eye.max(0);center=(lo+hi)*.5
            rx=max((hi[0]-lo[0])*.52,model['unit']*.25)
            rz=max((hi[2]-lo[2])*.52,model['unit']*.25)
            # Optical geometry is not perfectly symmetric; the front bound
            # guarantees the meeting lid is actually in front of the cornea.
            front=hi[1]
            seam_height=float(np.quantile(rim[:,2],.44))
            tilted=np.polyfit(rim[:,0]-center[0],rim[:,2]-seam_height,1)[0]
            tilted=float(np.clip(tilted,-.22,.22))
            ids=model['affected'];p=coords[ids]
            xnorm=np.clip((p[:,0]-center[0])/rx,-1.12,1.12)
            seam=seam_height+tilted*(p[:,0]-center[0])-.045*rz*(1-np.minimum(1,xnorm*xnorm))
            # Tiny upper/lower overlap avoids a light gap under mixed face
            # controls. The eye remains unchanged; actual skin covers it.
            upper=p[:,2]>seam
            overlap=model['unit']*.012
            target_z=seam+np.where(upper,-overlap,overlap)
            front_curve=front-model['unit']*.12*np.minimum(1,xnorm*xnorm)+model['unit']*.035
            target_depth=np.maximum(p[:,1],front_curve+np.clip(p[:,1]-center[1],-model['unit']*.4,model['unit']*.6)*.12)
            influence=model['blend']
            result[ids,2]=p[:,2]+(target_z-p[:,2])*influence
            result[ids,1]=p[:,1]+(target_depth-p[:,1])*influence
        return np.array(origin)+result@basis

    generated_lids=[]
    native_report={}
    if base_id=='sphynx':
        close,native_report=native_sphynx_closure(mesh,base,eye_ids)
    closed=close(base)
    blink_delta=closed-base
    key=mesh.shape_key_add(name='Blink',from_mix=False)
    key.data.foreach_set('co',closed.astype(np.float32).ravel())
    existing=[key for key in mesh.data.shape_keys.key_blocks if key.name not in ('Basis','Blink')]
    correctives=[]
    for target in existing:
        points=np.array([tuple(v.co)for v in target.data])
        posed_closed=close(points)
        correction=posed_closed-points-blink_delta
        name='Blink_'+target.name
        key=mesh.shape_key_add(name=name,from_mix=False)
        key.data.foreach_set('co',(base+correction).astype(np.float32).ravel())
        correctives.append(name)
    for target in mesh.data.shape_keys.key_blocks:target.value=0

    # Assign original UV-mapped globe polygons their own material. Clearcoat
    # gives controlled wet reflections without turning the black pupil metallic.
    original=mesh.data.materials[0]
    optical=original.copy();optical.name=base_id+'_EyeOptics'
    bsdf=next((node for node in optical.node_tree.nodes if node.type=='BSDF_PRINCIPLED'),None)
    if bsdf:
        # Remove the coat's roughness map only for the actual globe material.
        for input_name in ('Roughness','Normal'):
            for link in list(bsdf.inputs[input_name].links):optical.node_tree.links.remove(link)
        bsdf.inputs['Roughness'].default_value=.30
        if 'Clearcoat'in bsdf.inputs:
            bsdf.inputs['Clearcoat'].default_value=.8;bsdf.inputs['Clearcoat Roughness'].default_value=.10
        if 'Coat Weight'in bsdf.inputs:
            bsdf.inputs['Coat Weight'].default_value=.8;bsdf.inputs['Coat Roughness'].default_value=.10
        if 'IOR'in bsdf.inputs:bsdf.inputs['IOR'].default_value=1.376
    for eye_index,eye_set in enumerate(eye_sets):
        material=optical.copy();material.name=base_id+'_EyeOptics_'+('L'if eye_index==0 else'R')
        material['creatorRole']='eye-globe';material['creatorEyeSide']='L'if eye_index==0 else'R'
        mesh.data.materials.append(material)
        slot=len(mesh.data.materials)-1
        for poly in mesh.data.polygons:
            if all(int(i)in eye_set for i in poly.vertices):poly.material_index=slot
    bpy.data.materials.remove(optical)

    return {
      'method':'Actual upper/lower skin rim closure with geodesic falloff; original globe coordinates unchanged',**native_report,
      'blink':True,'generatedSkinLids':generated_lids,'rimVertices':[len(m['rim'])for m in models],
      'movingSkinVertices':int(np.sum(np.linalg.norm(blink_delta,axis=1)>1e-7)),
      'maxBlinkDisplacement':float(np.linalg.norm(blink_delta,axis=1).max()),
      'eyeIds':[list(map(int,ids))for ids in eye_ids],
      'correctives':correctives,'eyeMaterial':base_id+'_EyeOptics_L/R',
      'closedPoints':closed,
    }

