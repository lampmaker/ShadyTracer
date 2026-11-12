bump: minor

**The 3D print export writes OBJ + MTL as well** (File › Export ▸ 3D print (3MF / OBJ / STL)…). It's the same
coloured mesh as the 3MF, the material colours or the colours as lit, written as an OBJ and its material file. It's for
slicers that read an OBJ's colours but not a 3MF's. Bambu Studio before 2.5 opens another program's 3MF as "geometry
data only", but maps an OBJ's colours to filaments. Each palette colour is a material, and each face names its own, so
the mesh stays one closed mesh with each vertex written once. Vertex colours would have needed the vertices split along
every colour border, because a face takes the mean of its three. The values follow Bambu Studio's own OBJ loader: `Kd`
is the colour, `Ka` is written 0 (otherwise it adds a tenth of it), and `d 1` is opacity. The two files download under
one name with the time in it, so a browser doesn't rename the MTL to one the OBJ doesn't name. OBJ has no units:
millimetres, z up, as the STL.

**What to look at:** export a coloured part as OBJ + MTL, keep the two files in one folder, and open the OBJ in Bambu
Studio. The colour-to-filament dialog should list the export's colours, and the part should come in at its size in mm,
standing as it was.
