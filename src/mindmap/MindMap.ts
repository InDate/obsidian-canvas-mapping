import { marked } from 'marked';

type MindMapNode = {
	id: number;
	parentId: number | null;
	content: string;
};

export function markdownToMindMap(markdown: string): MindMapNode[] {
	const tokens = marked.lexer(markdown).filter(token => token.type !== 'space');
	let currentParentId: number | null = null;
	let nodeIdCounter = 0;

	const generateNode = (content: string, parentId: number | null): MindMapNode => ({
		id: nodeIdCounter++,
		parentId,
		content
	});

	let nodes: MindMapNode[] = [];

	nodes = tokens.flatMap((token, index) => {
		let i = index;

		switch (token.type) {
			case 'heading': {
				const parent = generateNode(token.text, token.depth === 1 ? null : nodes[0]?.id)
				currentParentId = parent.id
				return [parent];
			}
			case 'paragraph':
				if (i === tokens.length - 1) // last paragraph belongs to top
					return [generateNode(token.text, null)];
				else if (tokens[i + 1]?.type === 'list') {
					const parent = generateNode(token.text, null);
					const listNodes = tokens[i + 1].items?.map((item: { text: string; }) => generateNode(item.text, parent.id)) || [];
					i++;
					return [parent, ...listNodes];
				} else
					return [generateNode(token.text, currentParentId)];

			case 'list':
				if (!(tokens[i - 1]?.type === 'paragraph'))
					return token.items?.map((item: { text: string; }) => generateNode(item.text, currentParentId)) || [];
				break;

			default:
				return [];
		}
	}).filter(Boolean) // Filter operation to remove undefined;

	return nodes;
}


