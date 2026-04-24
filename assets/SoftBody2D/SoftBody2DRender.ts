import { _decorator, Component, Graphics, Color, PHYSICS_2D_PTM_RATIO, Vec3, Enum, EffectAsset } from 'cc';
import { SoftBody2D } from './SoftBody2D';
import { SoftBody2DPolygonRender } from './SoftBody2DPolygonRender';
const { ccclass, property } = _decorator;

const PPM = PHYSICS_2D_PTM_RATIO;

/** 渲染模式 */
export enum ERenderMode {
    /** 使用 cc.Graphics 组件绘制（默认） */
    Graphics  = 0,
    /** 使用自定义 RenderComponent + Assembler 直接提交顶点 */
    Assembler = 1,
}

@ccclass('SoftBody2DRender')
export class SoftBody2DRender extends Component {

    @property({ type: Enum(ERenderMode), tooltip: 'Graphics: 使用 cc.Graphics 绘制\nAssembler: 自定义装配器直接提交顶点' })
    renderMode: ERenderMode = ERenderMode.Graphics;

    @property({type: SoftBody2D, visible: true})
    private _softBody: SoftBody2D;

    private _graphics: Graphics = null;
    private _polygonRender: SoftBody2DPolygonRender = null;
    private _worldPos = new Vec3();
    private _localPos = new Vec3();
    private _contourIndices: number[] = null;

    protected start(): void {
        if (this.renderMode === ERenderMode.Graphics) {
            this._graphics = this.getComponent(Graphics);
            if (!this._graphics) {
                this._graphics = this.node.addComponent(Graphics);
            }
        } else {
            this._polygonRender = this.getComponent(SoftBody2DPolygonRender);
            if (!this._polygonRender) {
                this._polygonRender = this.node.addComponent(SoftBody2DPolygonRender);
                this._polygonRender.softBody = this._softBody;
            }
        }
    }

    update(): void {

        if (this.renderMode === ERenderMode.Assembler) {
            return;
        }
        if (!this._softBody || !this._softBody.particleSystem) return;

        const ps = this._softBody.particleSystem;
        const startIdx = this._softBody.groupStartIndex;
        const count = this._softBody.groupParticleCount;
        if (count === 0) {
            if (this.renderMode === ERenderMode.Graphics && this._graphics) {
                this._graphics.clear();
            }
            return;
        }

        const posBufPtr = Box2DWasm.getPointer(ps.GetPositionBuffer());
        // @ts-ignore
        const positions = new Float32Array(Box2DWasm.HEAPF32.buffer, posBufPtr + startIdx * 2 * 4, count * 2);

        const physRadius = ps.GetRadius();

        if (!this._contourIndices) {
            this._contourIndices = this.extractContour(positions, count, physRadius);
        }

        const chain = this._contourIndices;
        if (chain.length < 3) return;

        if (this.renderMode === ERenderMode.Graphics) {
            this.renderWithGraphics(positions, chain);
        } else {
            this.renderWithAssembler(positions, chain);
        }
    }

    // ---- Graphics 渲染路径（原有逻辑） ----

    private renderWithGraphics(positions: Float32Array, chain: number[]): void {
        this._graphics.clear();

        Vec3.set(this._worldPos, positions[chain[0] * 2] * PPM, positions[chain[0] * 2 + 1] * PPM, 0);
        this.node.inverseTransformPoint(this._localPos, this._worldPos);
        this._graphics.moveTo(this._localPos.x, this._localPos.y);

        for (let i = 1; i < chain.length; i++) {
            const idx = chain[i];
            Vec3.set(this._worldPos, positions[idx * 2] * PPM, positions[idx * 2 + 1] * PPM, 0);
            this.node.inverseTransformPoint(this._localPos, this._worldPos);
            this._graphics.lineTo(this._localPos.x, this._localPos.y);
        }

        this._graphics.close();
        this._graphics.fillColor = new Color(0, 0, 255, 255);
        this._graphics.fill();
    }

    // ---- Assembler 渲染路径 ----

    private renderWithAssembler(positions: Float32Array, chain: number[]): void {
    }

    // ---- 轮廓提取（Marching Squares） ----

    /** 用 Marching Squares 提取轮廓，返回有序粒子索引 */
    private extractContour(positions: Float32Array, count: number, radius: number): number[] {
        const cellSize = radius;
        const threshold = radius * 1.4;

        // 包围盒
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < count; i++) {
            const x = positions[i * 2], y = positions[i * 2 + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const margin = radius * 3;
        minX -= margin; minY -= margin; maxX += margin; maxY += margin;

        const cols = Math.ceil((maxX - minX) / cellSize);
        const rows = Math.ceil((maxY - minY) / cellSize);

        // 空间哈希加速
        const pCell = radius * 2;
        const phash = new Map<number, number[]>();
        const phashFn = (x: number, y: number) => {
            const gx = Math.floor(x / pCell), gy = Math.floor(y / pCell);
            return (gx * 73856093) ^ (gy * 19349663);
        };
        for (let i = 0; i < count; i++) {
            const k = phashFn(positions[i * 2], positions[i * 2 + 1]);
            let c = phash.get(k); if (!c) { c = []; phash.set(k, c); } c.push(i);
        }

        // 构建顶点二值网格 (cols+1) x (rows+1)
        const vCols = cols + 1, vRows = rows + 1;
        const vtx = new Uint8Array(vCols * vRows);
        const thSq = threshold * threshold;
        for (let r = 0; r < vRows; r++) {
            for (let c = 0; c < vCols; c++) {
                const wx = minX + c * cellSize, wy = minY + r * cellSize;
                const gx = Math.floor(wx / pCell), gy = Math.floor(wy / pCell);
                let inside = false;
                for (let dx = -1; dx <= 1 && !inside; dx++) {
                    for (let dy = -1; dy <= 1 && !inside; dy++) {
                        const cell = phash.get(((gx + dx) * 73856093) ^ ((gy + dy) * 19349663));
                        if (!cell) continue;
                        for (const j of cell) {
                            const ddx = positions[j * 2] - wx, ddy = positions[j * 2 + 1] - wy;
                            if (ddx * ddx + ddy * ddy < thSq) { inside = true; break; }
                        }
                    }
                }
                vtx[r * vCols + c] = inside ? 1 : 0;
            }
        }

        // Marching Squares: 每个格子4个角 → case 0-15 → 边上的线段
        // 边: N=0, E=1, S=2, W=3
        // N: (c,r)-(c+1,r), E: (c+1,r)-(c+1,r+1), S: (c+1,r+1)-(c,r+1), W: (c,r+1)-(c,r)
        type Pt = [number, number];
        const edgePt = (edge: number, c: number, r: number): Pt => {
            switch (edge) {
                case 0: return [minX + (c + 0.5) * cellSize, minY + r * cellSize];
                case 1: return [minX + (c + 1) * cellSize, minY + (r + 0.5) * cellSize];
                case 2: return [minX + (c + 0.5) * cellSize, minY + (r + 1) * cellSize];
                case 3: return [minX + c * cellSize, minY + (r + 0.5) * cellSize];
            }
        };

        const SEGMENTS: number[][][] = [
            [], [[2,3]], [[1,2]], [[1,3]], [[0,1]], [[0,1],[2,3]], [[0,2]], [[0,3]],
            [[0,3]], [[0,2]], [[0,3],[1,2]], [[0,1]], [[1,3]], [[1,2]], [[2,3]], []
        ];

        // 收集线段并用邻接表链接
        interface Seg { a: Pt; b: Pt; }
        const segs: Seg[] = [];
        const ptMap = new Map<string, number[]>();

        const pk = (p: Pt) => ((p[0] * 10000) | 0) + ',' + ((p[1] * 10000) | 0);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const nw = vtx[r * vCols + c], ne = vtx[r * vCols + c + 1];
                const se = vtx[(r + 1) * vCols + c + 1], sw = vtx[(r + 1) * vCols + c];
                const ci = (nw << 3) | (ne << 2) | (se << 1) | sw;
                for (const [ea, eb] of SEGMENTS[ci]) {
                    const si = segs.length;
                    const a = edgePt(ea, c, r), b = edgePt(eb, c, r);
                    segs.push({ a, b });
                    const ka = pk(a), kb = pk(b);
                    if (!ptMap.has(ka)) ptMap.set(ka, []);
                    if (!ptMap.has(kb)) ptMap.set(kb, []);
                    ptMap.get(ka).push(si);
                    ptMap.get(kb).push(si);
                }
            }
        }

        if (segs.length === 0) return [];

        // 链接线段成有序轮廓
        const used = new Uint8Array(segs.length);
        const contourPts: Pt[] = [segs[0].a, segs[0].b];
        used[0] = 1;
        let curKey = pk(segs[0].b);

        for (let step = 1; step < segs.length; step++) {
            const neighbors = ptMap.get(curKey);
            if (!neighbors) break;
            let found = false;
            for (const si of neighbors) {
                if (used[si]) continue;
                used[si] = 1;
                const seg = segs[si];
                if (pk(seg.a) === curKey) {
                    contourPts.push(seg.b);
                    curKey = pk(seg.b);
                } else {
                    contourPts.push(seg.a);
                    curKey = pk(seg.a);
                }
                found = true;
                break;
            }
            if (!found) break;
        }

        // 轮廓点 → 最近粒子索引
        const contourIndices: number[] = [];
        for (const pt of contourPts) {
            let nearestIdx = 0, nearestDist = Infinity;
            const gx = Math.floor(pt[0] / pCell), gy = Math.floor(pt[1] / pCell);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const cell = phash.get(((gx + dx) * 73856093) ^ ((gy + dy) * 19349663));
                    if (!cell) continue;
                    for (const j of cell) {
                        const ddx = positions[j * 2] - pt[0], ddy = positions[j * 2 + 1] - pt[1];
                        const dist = ddx * ddx + ddy * ddy;
                        if (dist < nearestDist) { nearestDist = dist; nearestIdx = j; }
                    }
                }
            }
            contourIndices.push(nearestIdx);
        }

        // 去重相邻重复
        const result: number[] = [contourIndices[0]];
        for (let i = 1; i < contourIndices.length; i++) {
            if (contourIndices[i] !== result[result.length - 1]) {
                result.push(contourIndices[i]);
            }
        }

        return result;
    }
}
