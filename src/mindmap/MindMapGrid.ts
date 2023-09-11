import { quadtree, Quadtree } from 'd3-quadtree';

export type NodeAction = 'addChild' | 'addSibling';
export type Coordinates = { x: number, y: number, width: number, height: number, id: number, action?: NodeAction };
export type NodeRadius = { centerX: number, centerY: number, radius: number};
export type OperationInput = { id: number, action: NodeAction, referenceCoordinates: Coordinates};

class MindMapGrid {
    private static defaultWidth = 100;
    private static defaultHeight = 50;
    private internalGrid: Quadtree<Coordinates>;

	constructor(serializedQuadTree?: ArrayBuffer ) {
		const internalGrid = quadtree<Coordinates>();

        if (serializedQuadTree) {
            const coordsArray = this.deserializeQuadTree(serializedQuadTree);
			internalGrid.addAll(coordsArray)
        }

		this.internalGrid = internalGrid
    }

    public operateOnNode(input: OperationInput, desiredPushDistance = 10, maxWidth = 200, maxHeight = 100): { newCoords: Coordinates, adjustedNodes: Coordinates[], serializedQuadTree: ArrayBuffer } {

        const {newCoords, adjustedNodes} = this.getNewNodePosition(input.id, input.action, input.referenceCoordinates, desiredPushDistance, maxWidth, maxHeight);

        this.internalGrid.add(newCoords);

        adjustedNodes.forEach(node => this.internalGrid.add(node));

        const updatedSerializedQuadTree = this.serializeQuadTree();

        return {
            newCoords: newCoords,
            adjustedNodes: adjustedNodes,
            serializedQuadTree: updatedSerializedQuadTree
        };
    }

    private getRadius(node: Coordinates): NodeRadius {
        const centerX = node.x + node.width/2;
        const centerY = node.y + node.height/2;
        const area = node.height * node.width;
        let radius: number;

        switch (node.action) {
            case 'addChild':
                radius = node.height / 2;
                break;
            case 'addSibling':
                radius = node.width / 2;
                break;
            default:
                radius = Math.sqrt(area / Math.PI);
                break;
        }

        return {centerX, centerY, radius};
    }

    private adjustOverlaps(node: Coordinates, desiredPushDistance: number): Coordinates[] {
        const adjustedNodes: Coordinates[] = [];
        const {centerX, centerY, radius} = this.getRadius(node);
        let overlaps = this.internalGrid.find(centerX, centerY, radius);

        while (overlaps) {
            if (overlaps.action === 'addChild') {
                overlaps.y += overlaps.height + desiredPushDistance;
                adjustedNodes.push(overlaps);
            } else if (overlaps.action === 'addSibling') {
                overlaps.x += overlaps.width + desiredPushDistance;
                adjustedNodes.push(overlaps);
            }

            adjustedNodes.push(...this.adjustOverlaps(overlaps, desiredPushDistance));
            const {centerX, centerY, radius} = this.getRadius(overlaps);
            overlaps = this.internalGrid.find(centerX, centerY, radius);
        }

        return adjustedNodes;
    }


    private getNewNodePosition(
        id: number,
        action: NodeAction,
        referenceNodeCoordinates: Coordinates,
        desiredPushDistance: number,
        maxWidth: number,
        maxHeight: number
    ): { newCoords: Coordinates, adjustedNodes: Coordinates[] } {
        const newCoords: Coordinates = {
            id: id,
            x: 0,
            y: 0,
            width: MindMapGrid.defaultWidth,
            height: MindMapGrid.defaultHeight,
            action: action
        };

        if (action === 'addChild') {
            newCoords.x = referenceNodeCoordinates.x;
            newCoords.y = referenceNodeCoordinates.y + referenceNodeCoordinates.height + desiredPushDistance;
        } else if (action === 'addSibling') {
            newCoords.x = referenceNodeCoordinates.x + referenceNodeCoordinates.width + desiredPushDistance;
            newCoords.y = referenceNodeCoordinates.y;
        }

        const adjustedNodes = this.adjustOverlaps(newCoords, desiredPushDistance);

        return {
            newCoords,
            adjustedNodes
        };
    }


    private serializeQuadTree(): ArrayBuffer {
        const data = this.internalGrid.data();
        // 16 bytes for id (assuming each character takes 1 byte) + 4 * 4 bytes for x, y, width, height
        const buffer = new ArrayBuffer(data.length * 20);
        const view = new DataView(buffer);

        data.forEach((coord: { id: number; x: number; y: number; width: number; height: number; }, index: number) => {
            const baseOffset = index * 20;
            view.setUint32(baseOffset, coord.id);
            view.setFloat32(baseOffset + 4, coord.x);
            view.setFloat32(baseOffset + 8, coord.y);
            view.setFloat32(baseOffset + 12, coord.width);
            view.setFloat32(baseOffset + 16, coord.height);
        });


        return buffer;
    }

    private deserializeQuadTree(buffer: ArrayBuffer) {
        const view = new DataView(buffer);
        const coordsArray: Coordinates[] = [];

        for (let i = 0; i < buffer.byteLength; i += 20) {
            const id = view.getUint32(i);
            const x = view.getFloat32(i + 4);
            const y = view.getFloat32(i + 8);
            const width = view.getFloat32(i + 12);
            const height = view.getFloat32(i + 16);
            coordsArray.push({ id, x, y, width, height });
        }

		return coordsArray
    }

}

export default MindMapGrid;
