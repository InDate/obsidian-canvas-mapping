
import MindMapGrid, {OperationInput, Coordinates} from '../src/mindmap/MindMapGrid';

jest.mock('d3-quadtree', () => ({
    quadtree: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
        find: jest.fn(),
        data: jest.fn().mockReturnValue([])
    }))
}));

describe('MindMapGrid', () => {
    let mindMapGrid: MindMapGrid;
	let data: ArrayBuffer;
    
    beforeAll(() => {
        mindMapGrid = new MindMapGrid();
    });

    it('should create a new node when input SerializedQuadTree is undefined', () => {
        const input = {
            id: 1, action: "addChild", 
            referenceCoordinates: {x: 0, y: 0, width: 10, height: 10, id: 0} 
        };

		// @ts-ignore
        const actual = mindMapGrid.operateOnNode(input);
		data = actual.serializedQuadTree;
       
        expect(actual).toEqual( expect.objectContaining({
            newCoords: expect.any(Object), 
            adjustedNodes: [],
            serializedQuadTree: expect.any(ArrayBuffer)
        }) );
    });

	it('should properly deserialize the input SerializedQuadTree when provided', () => {
		const second = new MindMapGrid(data);
        const input = {
            id: 22, action: "addSibling",
            referenceCoordinates: {x: 0, y: 0, width: 10, height: 10, id: 33}
        };

        // @ts-ignore
        const response = second.operateOnNode(input);
		console.log(response)

		expect(response).toBeDefined();
		expect(response).toHaveProperty('newCoords');
		expect(response.newCoords).toEqual({ id: 22, x: 20, y: 0, width: 100, height: 50, action: 'addSibling' });
    });

	it('should properly adjust overlapped nodes', () => {
        const initData: Coordinates[] = [
            { id: 1, x: 0, y: 0, width: 10, height: 10 },
            { id: 2, x: 5, y: 5, width: 20, height: 20 } // This creates overlap with Node 1
        ];
        
        // Convert initData to ArrayBuffer for initializing MindMapGrid
        const serializedInitialData = new ArrayBuffer(initData.length * 20);
        const view = new DataView(serializedInitialData);
        initData.forEach((coord, index) => {
            const baseOffset = index * 20;
            view.setUint32(baseOffset, coord.id);
            view.setFloat32(baseOffset + 4, coord.x);
            view.setFloat32(baseOffset + 8, coord.y);
            view.setFloat32(baseOffset + 12, coord.width);
            view.setFloat32(baseOffset + 16, coord.height);
        });

        // Create MindMapGrid instance
        const mindMapGrid = new MindMapGrid(serializedInitialData);

        // Define inputs (replace with actual values)
        const inputForNodeOperation: OperationInput = {
            id: 3,
            action: 'addChild',
            referenceCoordinates: { id: 2, x: 5, y: 5, width: 20, height: 20 }
        };

        // Execute operation
        const { newCoords, adjustedNodes } = mindMapGrid.operateOnNode(inputForNodeOperation);

        // Write expectations
        expect(newCoords).toBeDefined();
        expect(adjustedNodes).toBeDefined();

        // More detailed tests here (depends on nodes' initial coordinates and how they should be moved)
        // e.g., testing that the nodes aren't overlapping anymore
    });
});
