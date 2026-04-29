import { _decorator, Component, Node, PhysicsSystem2D, UITransform, Vec3, PHYSICS_2D_PTM_RATIO, EPhysics2DDrawFlags, Collider2D, BoxCollider2D, PolygonCollider2D } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
const { ccclass, property } = _decorator;

const PPM = PHYSICS_2D_PTM_RATIO; // pixels per meter


function shapeInit() {

    if (this._inited) return;

    const comp: Collider2D = this.collider;
    const scale = comp.node.worldScale;
    // relative Position from shape to rigid body
    let relativePosition = Vec3.ZERO;

    const body: SoftBody2D = comp.getComponent(SoftBody2D);


    const shapes = scale.x === 0 && scale.y === 0 ? [] : this._createShapes(scale.x, scale.y, relativePosition.x, relativePosition.y);

    for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        this._shapes.push(shape);
    }

    // Convert node world position to Box2D coordinates
    const wp = body.node.getWorldPosition(new Vec3());
    const px = wp.x / PPM;
    const py = wp.y / PPM;
    // @ts-ignore
    this._particleHandles = [];
    for (let shapePtr of  this._shapes) {
        // Create soft body particle group matching transform shape
        const gd = new Box2DWasm.b2ParticleGroupDef();
        gd.set_flags(Box2DWasm.b2_elasticParticle);
        gd.set_groupFlags(Box2DWasm.b2_solidParticleGroup);
        gd.set_angle(body.node.eulerAngles.z * Math.PI / 180);
        gd.set_strength(0.2);
        gd.set_shapeCount(1);
        const shape = Box2DWasm.wrapPointer(shapePtr, Box2DWasm.b2PolygonShape);
        gd.set_shape(shape);
        gd.set_position(new Box2DWasm.b2Vec2(px, py));
        gd.set_color(new Box2DWasm.b2ParticleColor(255, 0, 0, 255));
        if (body._particleGroup) {
            gd.set_group(body._particleGroup);
        }

        const ps = body.particleSystem;

        // 粒子容量不足时跳过，避免 WASM 越界崩溃
        if (ps.GetParticleCount() >= SoftBody2D.maxParticleCount) {
            this._inited = true;
            return;
        }

        const group = ps.CreateParticleGroup(gd);

        const count = group.GetParticleCount();
        const startIndex = ps.GetParticleCount() - count;
        for (let i = 0; i < count; i++) {
            this._particleHandles.push(ps.GetParticleHandleFromIndex(startIndex + i));
        }

        if (!body._particleGroup) {
            body._particleGroup = group;
        }
    }

    this._inited = true;
}


function shapeDestroy() {
    const comp: Collider2D = this.collider;
    const body: SoftBody2D = comp.getComponent(SoftBody2D);
    if (!body.particleSystem) return;

    // @ts-ignore
    for (const handle of this._particleHandles) {
        body.particleSystem.DestroyParticle(handle.GetIndex());
    }
}

@ccclass('SoftBody2D')
@_decorator.executionOrder(100)
export class SoftBody2D extends Component {

    // 共享粒子系统：所有 SoftBody2D 实例共用同一个 b2ParticleSystem
    private static _sharedPS: Box2DWasm.b2ParticleSystem = null;
    private static _refCount = 0;
    static maxParticleCount = 5000;

    _particleGroup: Box2DWasm.b2ParticleGroup = null;

    get particleSystem(): Box2DWasm.b2ParticleSystem {
        return SoftBody2D._sharedPS;
    }

    /** 本组粒子在全局 buffer 中的起始索引 */
    get groupStartIndex(): number {
        return this._particleGroup ? this._particleGroup.GetBufferIndex() : 0;
    }

    /** 本组粒子数量 */
    get groupParticleCount(): number {
        return this._particleGroup ? this._particleGroup.GetParticleCount() : 0;
    }

    protected __preload(): void {
        const colliders = this.getComponents(Collider2D);
        colliders.forEach(collider => {
            // @ts-ignore
            const _onLoad = collider.onLoad;
            // @ts-ignore
            collider.onLoad = function () {
                _onLoad.call(this);
                // @ts-ignore
                this._shape._init = shapeInit;
                // @ts-ignore
                const _shapeDetroy = this._shape.destroy;
                this._shape.destroy = function() {
                    shapeDestroy.call(this);
                    _shapeDetroy.call(this);
                };
            }
        });
    }

    protected onLoad(): void {

        if (!EDITOR_NOT_IN_PREVIEW) {
            SoftBody2D._refCount++;

            if (!SoftBody2D._sharedPS) {
                const world: Box2DWasm.b2World = PhysicsSystem2D.instance.physicsWorld.impl._obj;

                const psDef = new Box2DWasm.b2ParticleSystemDef();
                psDef.set_radius(0.3);
                psDef.set_maxCount(SoftBody2D.maxParticleCount);
                psDef.set_dampingStrength(0.8);
                psDef.set_elasticStrength(0.05);
                psDef.set_springStrength(0.1);
                psDef.set_pressureStrength(0.15);
                psDef.set_ejectionStrength(0.2);
                psDef.set_destroyByAge(false);
                SoftBody2D._sharedPS = world.CreateParticleSystem(psDef);
            }
        }
    }

    protected onEnable(): void {
        if (SoftBody2D._sharedPS) {
            SoftBody2D._sharedPS.SetPaused(false);
        }
    }

    protected onDisable(): void {
        if (SoftBody2D._sharedPS) {
            SoftBody2D._sharedPS.SetPaused(true);
        }
    }

    protected onDestroy(): void {
        // 销毁所有 collider 的粒子（通过 handles 精准销毁）
        const colliders = this.getComponents(Collider2D);
        colliders.forEach(collider => {
            // @ts-ignore
            if (collider._shape) {
                // @ts-ignore
                shapeDestroy.call(collider._shape);
            }
        });

        this._particleGroup = null;
        SoftBody2D._refCount--;

        // 最后一个实例负责销毁共享粒子系统
        if (SoftBody2D._refCount <= 0) {
            SoftBody2D._refCount = 0;
            if (SoftBody2D._sharedPS) {
                const world: Box2DWasm.b2World = PhysicsSystem2D.instance.physicsWorld.impl._obj;
                world.DestroyParticleSystem(SoftBody2D._sharedPS);
                SoftBody2D._sharedPS = null;
            }
        }
    }

    update(deltaTime: number) {
        if (!SoftBody2D._sharedPS) return;
        if (!this._particleGroup) return;
        if (this._particleGroup.GetParticleCount() === 0) return;

        const pos = this._particleGroup.GetCenter();
        const angle = this._particleGroup.GetAngle();
        this.node.setWorldPosition(new Vec3(pos.get_x() * PPM, pos.get_y() * PPM, 0));
        this.node.setRotationFromEuler(0, 0, angle * 180 / Math.PI);
    }
}

