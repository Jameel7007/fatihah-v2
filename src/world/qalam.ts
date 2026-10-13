// The qalam (R2) — a reed pen: a tapered cane with a cut, ink-stained nib and faint growth
// rings, held leaning up and to the right of the line (a right hand writing right to left) and
// a little back toward the writer. It casts its own shadow, so its tip visibly meets the page.

import { Group, LatheGeometry, Mesh, MeshStandardNodeMaterial, Quaternion, Vector2, Vector3 } from 'three/webgpu';
import { color, float, positionLocal, smoothstep } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const LENGTH = 0.17;
/** the pen's axis from the nib toward its top, in world space */
export const PEN_LEAN = new Vector3(0.36, 0.86, 0.36).normalize(); // ≈ 59° up from the page

export class Qalam {
  readonly group = new Group();
  private readonly tilt = new Quaternion();

  constructor() {
    // profile along the axis (y): a fine nib, the cut taper, then the cane
    const pts: Vector2[] = [];
    const prof: Array<[number, number]> = [
      [0.00012, 0],
      [0.0009, 0.0018],
      [0.0021, 0.006],
      [0.0031, 0.013],
      [0.0036, 0.024],
      [0.0039, 0.07],
      [0.0042, 0.14],
      [0.0041, LENGTH - 0.002],
      [0.0, LENGTH],
    ];
    for (const [r, y] of prof) pts.push(new Vector2(r, y));
    const geo = new LatheGeometry(pts, 20);
    // the nib is cut on one side: flatten the lathe's front where it tapers
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.013) {
        const z = pos.getZ(i);
        if (z > 0) pos.setZ(i, z * (0.25 + 0.75 * (y / 0.013)));
      }
    }
    geo.computeVertexNormals();
    const m = new MeshStandardNodeMaterial();
    const v: N = positionLocal.y.div(LENGTH); // 0 at the nib → 1 at the top (lathe uvs go by point index)
    // dried reed, darker toward the top, two faint growth rings, the nib stained with ink
    const cane: N = color('#8C6A3E').mul(float(1).sub(v.mul(0.25)));
    const ring = (at: number): N => smoothstep(0.012, 0.0, v.sub(at).abs()).mul(0.35);
    const ringed: N = cane.mul(float(1).sub(ring(0.45)).sub(ring(0.8)));
    const stain: N = smoothstep(0.1, 0.03, v);
    m.colorNode = ringed.mul(float(1).sub(stain)).add(color('#1A120C').mul(stain));
    m.roughnessNode = float(0.55).sub(stain.mul(0.3));
    const mesh = new Mesh(geo, m);
    mesh.name = 'qalam';
    mesh.castShadow = true;
    this.group.add(mesh);
    this.tilt.setFromUnitVectors(new Vector3(0, 1, 0), PEN_LEAN);
    this.group.quaternion.copy(this.tilt);
    this.group.visible = false;
  }

  /** Put the nib at `tip` (world), raised `lift` along the page normal `n`. */
  place(tip: Vector3, n: Vector3, lift: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.copy(tip).addScaledVector(n, lift + 0.0004);
    this.group.updateMatrixWorld();
  }
}
