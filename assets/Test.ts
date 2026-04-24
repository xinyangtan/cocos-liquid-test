import { _decorator, Component, EPhysics2DDrawFlags, game, Node, PhysicsSystem2D, Prefab, RigidBody2D, tween, EventTouch, Vec3, UITransform, instantiate, math } from 'cc';
import { SoftBody2D } from './SoftBody2D/SoftBody2D';
const { ccclass, property } = _decorator;

@ccclass('Test')
export class Test extends Component {

    @property({type: SoftBody2D, visible: true})
    private _softBody: SoftBody2D;

    @property({type: RigidBody2D, visible: true})
    private _rigidBody: RigidBody2D;

    @property({type: [Prefab], visible: true})
    private _prefabs: Prefab[] = [];

    start() {
        this.node.on(Node.EventType.TOUCH_END, this._onTouch, this);

        // this.schedule(() => {

        //     const node = instantiate(this._prefabs[1]);
        //     node.setPosition(new Vec3(0, 500, 0));
        //     this.node.addChild(node);
        // }, 4, 3);
    }

    private _onTouch(event: EventTouch): void {
        const index = math.randomRangeInt(0, this._prefabs.length);
        const prefab = this._prefabs[index];
        if (!prefab) return;

        const uiTransform = this.node.getComponent(UITransform);
        const pos = event.getUILocation();
        const local = uiTransform ? uiTransform.convertToNodeSpaceAR(new Vec3(pos.x, pos.y, 0)) : new Vec3(pos.x, pos.y, 0);

        const node = instantiate(prefab);
        node.setPosition(local);
        this.node.addChild(node);
    }

    onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this._onTouch, this);
    }
}


// PhysicsSystem2D.instance.debugDrawFlags = EPhysics2DDrawFlags.All;