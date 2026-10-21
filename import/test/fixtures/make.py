# The import tests' parts, made with OpenCascade (CadQuery) so that they are what a CAD program writes.
#
#   python3 -m venv occ && occ/bin/pip install cadquery && occ/bin/python import/test/fixtures/make.py
#
# NOT RUN BY CI: the files it writes are committed, and the Node tests read them. Run it again only to change a part,
# and say so in the commit. Per part it writes <name>.step (AP214, as CadQuery exports), <name>.stl (OpenCascade's
# tessellation, binary) and <name>.json: what OpenCascade itself says of the solid -- its volume, its box, its faces'
# surface types -- and points classified in or out by its own solid classifier (BRepClass3d_SolidClassifier), which is
# what the Node tests hold the converted CSG to. Units are millimetres throughout.
#
# ONE PART IS NOT MADE HERE: onshape.step is the user's own file (Onshape's AP242 export of a 56 mm cup, in metres; the
# user asked for it to be a test part, 2026-10-21), committed as it came. This reads it -- CadQuery converts it to mm --
# and writes onshape.json from it as from the others. No STL: the user gave none.
import json, random, sys, os
import cadquery as cq
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_OUT, TopAbs_ON
from OCP.gp import gp_Pnt
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.TopoDS import TopoDS_Compound
from OCP.BRep import BRep_Builder

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {GeomAbs_Plane: 'plane', GeomAbs_Cylinder: 'cylinder', GeomAbs_Cone: 'cone', GeomAbs_Sphere: 'sphere', GeomAbs_Torus: 'torus'}

def parts():
    # a plate with four through holes and a blind pocket: planes and concave cylinders only
    plate = (cq.Workplane('XY').box(40, 30, 5)
             .faces('>Z').workplane().rect(30, 20, forConstruction=True).vertices().hole(4)
             .faces('>Z').workplane().rect(12, 8).cutBlind(-2))
    # an L bracket: a concave fillet inside the bend, a convex one outside, a slot-free hole in each leg
    bracket = (cq.Workplane('XZ').polyline([(0, 0), (30, 0), (30, 4), (4, 4), (4, 25), (0, 25)]).close().extrude(-20)
               .edges('|Y').edges(cq.selectors.NearestToPointSelector((4, 10, 4))).fillet(3)
               .edges('|Y').edges(cq.selectors.NearestToPointSelector((0, 10, 0))).fillet(2)
               .faces('>Z[-2]').workplane(centerOption='CenterOfBoundBox').center(5, 0).hole(5)
               .faces('<X').workplane(centerOption='CenterOfBoundBox').center(0, 3).hole(5))
    # a round base with a boss: a torus where they meet, a cone chamfering the boss's top, a hole through both
    boss = (cq.Workplane('XY').circle(15).extrude(3)
            .faces('>Z').workplane().circle(6).extrude(8)
            .edges('%CIRCLE').edges(cq.selectors.BoxSelector((-7, -7, 2.9), (7, 7, 3.1))).fillet(1.5)
            .faces('>Z').edges().chamfer(1)
            .faces('>Z').workplane().hole(4))
    # a biconvex spherical lens, R1 = 20, R2 = 30, 12 across, 4 thick at its centre: spheres and a cylinder
    lens = lens_solid(12, 4, 20, 30)
    # a box with every edge rounded: 12 cylinders and 8 sphere corners, tangent to the planes
    roundbox = cq.Workplane('XY').box(20, 14, 10).edges().fillet(2)
    # a cup lying along y, as a part drawn on a CAD program's front plane comes (a user's Onshape part of 2026-10-21 was
    # one like it): a 56 mm disc and a 44 mm square rounded 3 mm at its corners, which stick out of the disc and split
    # its cylinder into four faces; hollowed from below by a 40 mm square rounded 1 mm, 25 mm deep; two 2 mm holes in its lid
    outer = cq.Workplane('XY').circle(28).extrude(29).union(cq.Workplane('XY').rect(44, 44).extrude(29).edges('|Z').fillet(3))
    cup = outer.cut(cq.Workplane('XY').rect(40, 40).extrude(25).edges('|Z').fillet(1))
    cup = cup.faces('>Z').workplane(centerOption='ProjectedOrigin').pushPoints([(13.79, 13.79), (-13.79, -13.79)]).hole(2)
    cup = cup.rotate((0, 0, 0), (1, 0, 0), -90)
    return {'plate': plate, 'bracket': bracket, 'boss': boss, 'lens': lens, 'roundbox': roundbox, 'cup': cup}

def lens_solid(D, t, R1, R2):
    s1 = cq.Workplane('XY').sphere(R1).translate((0, 0, t / 2 - R1))
    s2 = cq.Workplane('XY').sphere(R2).translate((0, 0, -t / 2 + R2))
    c = cq.Workplane('XY').circle(D / 2).extrude(t * 2).translate((0, 0, -t))
    return s1.intersect(s2).intersect(c)

def facts(shape, n_far=1500, n_near=1500, seed=1):
    solid = shape.val()
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(solid.wrapped, props)
    bb = solid.BoundingBox()
    lo, hi = [bb.xmin, bb.ymin, bb.zmin], [bb.xmax, bb.ymax, bb.zmax]
    kinds = {}
    for f in solid.Faces():
        k = TYPES.get(BRepAdaptor_Surface(f.wrapped).GetType(), 'other')
        kinds[k] = kinds.get(k, 0) + 1
    rnd = random.Random(seed)
    pad = [0.15 * (h - l) + 0.5 for l, h in zip(lo, hi)]
    def classify(p):
        c = BRepClass3d_SolidClassifier(solid.wrapped, gp_Pnt(*p), 1e-7)
        s = c.State()
        return 1 if s == TopAbs_IN else 0 if s == TopAbs_OUT else -1
    # TO THE SURFACE, its shells: to the solid itself, a point inside a solid read from a STEP file is 0 away ("inner
    # solution") -- the user's onshape.step had 1007 points inside at 0 -- while one CadQuery built here was not; the
    # shells give every built part's stored distances again, to the 1e-6 they are written to (2026-10-21)
    shells = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(shells)
    for sh in solid.Shells():
        builder.Add(shells, sh.wrapped)
    def dist(p):
        d = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex(), shells)
        return d.Value()
    pts = []
    # far: anywhere in the padded box; near: around points on the faces, a little either side
    for _ in range(n_far):
        pts.append([rnd.uniform(l - q, h + q) for l, h, q in zip(lo, hi, pad)])
    faces = solid.Faces()
    areas = [f.Area() for f in faces]
    for _ in range(n_near):
        f = rnd.choices(faces, areas)[0]
        u0, u1, v0, v1 = f._uvBounds()
        S = BRepAdaptor_Surface(f.wrapped)
        for _try in range(50):
            q = S.Value(rnd.uniform(u0, u1), rnd.uniform(v0, v1))
            p = cq.Vector(q.X(), q.Y(), q.Z())
            if dist([p.x, p.y, p.z]) < 1e-6:
                break
        n = f.normalAt(p)
        e = rnd.choice([-1, 1]) * rnd.uniform(0.01, 0.3)
        pts.append([p.x + e * n.x, p.y + e * n.y, p.z + e * n.z])
    out = []
    for p in pts:
        c = classify(p)
        if c < 0:
            continue
        out.append([round(x, 6) for x in p] + [c, round(dist(p), 6)])
    return {'volume': props.Mass(), 'lo': lo, 'hi': hi, 'faces': len(faces), 'kinds': kinds, 'points': out}

def assembly():
    # two parts of other fixtures placed in an assembly: the lens turned on its side and moved, the boss moved -- the
    # file then holds each part once and says where it sits (REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION)
    ps = parts()
    a = cq.Assembly(name='bench')
    a.add(ps['boss'], name='holder', loc=cq.Location(cq.Vector(0, 0, -11)))
    a.add(ps['lens'], name='lens', loc=cq.Location(cq.Vector(5, 3, 8), cq.Vector(1, 0, 0), 90))
    return a

def main():
    only = sys.argv[1:]
    if not only or 'assembly' in only:
        a = assembly()
        a.export(os.path.join(HERE, 'assembly.step'))
        # the classifier and the volume of the two solids together, as placed
        f = facts(cq.Workplane('XY').add(a.toCompound()), n_far=1000, n_near=1000)
        with open(os.path.join(HERE, 'assembly.json'), 'w') as fh:
            json.dump({'part': 'assembly', 'made': 'import/test/fixtures/make.py with CadQuery ' + cq.__version__, **f}, fh, separators=(',', ':'))
        print('assembly', f['faces'], f['kinds'], round(f['volume'], 3), len(f['points']))
    if not only or 'onshape' in only:
        f = facts(cq.importers.importStep(os.path.join(HERE, 'onshape.step')))
        with open(os.path.join(HERE, 'onshape.json'), 'w') as fh:
            json.dump({'part': 'onshape', 'made': 'import/test/fixtures/make.py with CadQuery ' + cq.__version__ + ' from the user\'s own onshape.step', **f}, fh, separators=(',', ':'))
        print('onshape', f['faces'], f['kinds'], round(f['volume'], 3), len(f['points']))
    for name, shape in parts().items():
        if only and name not in only:
            continue
        cq.exporters.export(shape, os.path.join(HERE, name + '.step'))
        cq.exporters.export(shape, os.path.join(HERE, name + '.stl'), tolerance=0.02, angularTolerance=0.2)
        f = facts(shape)
        with open(os.path.join(HERE, name + '.json'), 'w') as fh:
            json.dump({'part': name, 'made': 'import/test/fixtures/make.py with CadQuery ' + cq.__version__, **f}, fh, separators=(',', ':'))
        print(name, f['faces'], f['kinds'], round(f['volume'], 3), len(f['points']))

main()
