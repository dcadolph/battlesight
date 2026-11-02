package importer

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
)

// LandMask answers whether a coordinate sits on land, built from the world-atlas
// land TopoJSON.
type LandMask struct {
	// polys holds every land polygon as a list of rings in lng, lat order.
	polys []landPoly
}

// landPoly is one land polygon with its rings and a bounding box for fast rejection.
type landPoly struct {
	// rings holds the outer ring and any holes as closed point lists.
	rings [][][2]float64
	// minLng, minLat, maxLng, maxLat bound every ring of the polygon.
	minLng, minLat, maxLng, maxLat float64
}

// topology is the subset of the TopoJSON format the land file uses.
type topology struct {
	// Transform dequantizes arc coordinates.
	Transform struct {
		// Scale multiplies each quantized coordinate.
		Scale [2]float64 `json:"scale"`
		// Translate offsets each scaled coordinate.
		Translate [2]float64 `json:"translate"`
	} `json:"transform"`
	// Arcs holds delta-encoded quantized point lists.
	Arcs [][][2]float64 `json:"arcs"`
	// Objects holds the named geometry collections.
	Objects map[string]struct {
		// Geometries holds the members of a GeometryCollection.
		Geometries []struct {
			// Type is Polygon or MultiPolygon.
			Type string `json:"type"`
			// Arcs references arcs by index, with ~i meaning arc i reversed.
			Arcs json.RawMessage `json:"arcs"`
		} `json:"geometries"`
	} `json:"objects"`
}

// LoadLandMask reads a world-atlas land TopoJSON file such as land-50m.json.
func LoadLandMask(path string) (*LandMask, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%w: read: %w", ErrLandMask, err)
	}
	var topo topology
	if err := json.Unmarshal(raw, &topo); err != nil {
		return nil, fmt.Errorf("%w: decode: %w", ErrLandMask, err)
	}
	obj, ok := topo.Objects["land"]
	if !ok {
		return nil, fmt.Errorf("%w: no land object in %s", ErrLandMask, path)
	}
	arcs := decodeArcs(topo)
	mask := &LandMask{}
	for _, g := range obj.Geometries {
		var polys [][][]int
		switch g.Type {
		case "Polygon":
			var p [][]int
			if err := json.Unmarshal(g.Arcs, &p); err != nil {
				return nil, fmt.Errorf("%w: decode polygon arcs: %w", ErrLandMask, err)
			}
			polys = [][][]int{p}
		case "MultiPolygon":
			if err := json.Unmarshal(g.Arcs, &polys); err != nil {
				return nil, fmt.Errorf("%w: decode multipolygon arcs: %w", ErrLandMask, err)
			}
		default:
			continue
		}
		for _, p := range polys {
			if len(p) == 0 {
				continue
			}
			mask.polys = append(mask.polys, buildPoly(p, arcs))
		}
	}
	if len(mask.polys) == 0 {
		return nil, fmt.Errorf("%w: no polygons in %s", ErrLandMask, path)
	}
	return mask, nil
}

// decodeArcs turns the quantized delta-encoded arcs into absolute lng, lat points.
func decodeArcs(topo topology) [][][2]float64 {
	out := make([][][2]float64, len(topo.Arcs))
	sx, sy := topo.Transform.Scale[0], topo.Transform.Scale[1]
	tx, ty := topo.Transform.Translate[0], topo.Transform.Translate[1]
	for i, arc := range topo.Arcs {
		var x, y float64
		pts := make([][2]float64, len(arc))
		for j, d := range arc {
			x += d[0]
			y += d[1]
			pts[j] = [2]float64{x*sx + tx, y*sy + ty}
		}
		out[i] = pts
	}
	return out
}

// buildPoly stitches a polygon's arc references into closed rings. The first ring
// is the outer boundary.
func buildPoly(ringRefs [][]int, arcs [][][2]float64) landPoly {
	p := landPoly{minLng: 180, minLat: 90, maxLng: -180, maxLat: -90}
	for _, refs := range ringRefs {
		var ring [][2]float64
		for k, ref := range refs {
			var seg [][2]float64
			if ref >= 0 {
				seg = arcs[ref]
			} else {
				src := arcs[^ref]
				seg = make([][2]float64, len(src))
				for i := range src {
					seg[i] = src[len(src)-1-i]
				}
			}
			if k > 0 && len(seg) > 0 {
				seg = seg[1:]
			}
			ring = append(ring, seg...)
		}
		ring = unwrapRing(ring)
		for _, pt := range ring {
			p.minLng = math.Min(p.minLng, pt[0])
			p.maxLng = math.Max(p.maxLng, pt[0])
			p.minLat = math.Min(p.minLat, pt[1])
			p.maxLat = math.Max(p.maxLat, pt[1])
		}
		p.rings = append(p.rings, ring)
	}
	return p
}

// unwrapRing rewrites ring longitudes so consecutive points never differ by more
// than 180 degrees, which keeps a ring that crosses the antimeridian contiguous. A
// ring that still winds once around the globe encloses a pole, so it is closed
// through that pole. The ring is then shifted so its westernmost point lies in
// [-180, 180).
func unwrapRing(ring [][2]float64) [][2]float64 {
	if len(ring) < 2 {
		return ring
	}
	var latSum float64
	for i := 1; i < len(ring); i++ {
		d := ring[i][0] - ring[i-1][0]
		ring[i][0] -= 360 * math.Round(d/360)
		latSum += ring[i][1]
	}
	first, last := ring[0], ring[len(ring)-1]
	if math.Abs(last[0]-first[0]) > 180 {
		pole := 90.0
		if latSum < 0 {
			pole = -90
		}
		ring = append(ring, [2]float64{last[0], pole}, [2]float64{first[0], pole}, first)
	}
	minLng := math.Inf(1)
	for _, pt := range ring {
		minLng = math.Min(minLng, pt[0])
	}
	shift := -360 * math.Floor((minLng+180)/360)
	if shift != 0 {
		for i := range ring {
			ring[i][0] += shift
		}
	}
	return ring
}

// OnLand reports whether the point is inside a land polygon or within tolKM of one.
// Rings are unwrapped and may extend past 180 degrees east, so the point is also
// tested one turn east and west.
func (m *LandMask) OnLand(lat, lng, tolKM float64) bool {
	degLat := tolKM / 110.57
	cosLat := math.Max(math.Cos(lat*math.Pi/180), 0.01)
	degLng := tolKM / (111.32 * cosLat)
	for i := range m.polys {
		p := &m.polys[i]
		if lat < p.minLat-degLat || lat > p.maxLat+degLat {
			continue
		}
		for _, x := range [3]float64{lng, lng + 360, lng - 360} {
			if x < p.minLng-degLng || x > p.maxLng+degLng {
				continue
			}
			if p.contains(lat, x) {
				return true
			}
			if tolKM > 0 && p.distanceKM(lat, x, cosLat) <= tolKM {
				return true
			}
		}
	}
	return false
}

// contains runs an even-odd ray cast on the outer ring only. Holes in the land
// file are lakes, and a battle on a lakeshore is a land battle.
func (p *landPoly) contains(lat, lng float64) bool {
	inside := false
	for _, ring := range p.rings[:1] {
		n := len(ring)
		for i, j := 0, n-1; i < n; j, i = i, i+1 {
			xi, yi := ring[i][0], ring[i][1]
			xj, yj := ring[j][0], ring[j][1]
			if (yi > lat) != (yj > lat) && lng < (xj-xi)*(lat-yi)/(yj-yi)+xi {
				inside = !inside
			}
		}
	}
	return inside
}

// distanceKM returns the shortest distance from the point to the outer ring, using
// an equirectangular projection centered on the point.
func (p *landPoly) distanceKM(lat, lng, cosLat float64) float64 {
	best := math.Inf(1)
	proj := func(pt [2]float64) (float64, float64) {
		return (pt[0] - lng) * 111.32 * cosLat, (pt[1] - lat) * 110.57
	}
	for _, ring := range p.rings[:1] {
		for i := 1; i < len(ring); i++ {
			ax, ay := proj(ring[i-1])
			bx, by := proj(ring[i])
			best = math.Min(best, segmentDistance(ax, ay, bx, by))
		}
	}
	return best
}

// segmentDistance returns the distance from the origin to the segment a-b.
func segmentDistance(ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l2 := dx*dx + dy*dy
	t := 0.0
	if l2 > 0 {
		t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/l2))
	}
	cx, cy := ax+t*dx, ay+t*dy
	return math.Hypot(cx, cy)
}
