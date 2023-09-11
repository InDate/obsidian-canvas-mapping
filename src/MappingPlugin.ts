import { ItemView, Notice, Plugin, TFile } from 'obsidian'
import { AllCanvasNodeData } from 'obsidian/canvas'
import { Canvas, CanvasNode, CreateNodeOptions } from './obsidian/canvas-internal'
import { CanvasView, addEdge } from './obsidian/obsidian-utils'
import { getChatGPTCompletion } from './openai/chatGPT'
import { openai } from './openai/chatGPT-types'
import { MappingSettings, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from './settings/MappingSettings'
import SettingsTab from './settings/SettingsTab'
import { randomHexString } from './utils'
import { markdownToMindMap } from './mindmap/MindMap'
/**
 * Minimum width for new notes
 */
const minWidth = 360

/**
 * Assumed pixel width per character
 */
const pxPerChar = 5

/**
 * Assumed pixel height per line
 */
const pxPerLine = 28

/**
 * Assumed height of top + bottom text area padding
 */
const textPaddingHeight = 12

/**
 * Color for assistant notes: 6 == purple
 */
const assistantColor = "6"

/**
 * Margin between new notes
 */
const newNoteMargin = 60

/**
 * Min height of new notes
 */
const minHeight = 60

/**
 * Height to use for new empty note
 */
const emptyNoteHeight = 100

/**
 * Height to use for placeholder note
 */
const placeholderNoteHeight = 60

/**
 * Obsidian plugin implementation.
 * Note: Canvas has no supported API. This plugin uses internal APIs that may change without notice.
 */
export class MappingPlugin extends Plugin {
	unloaded = false
	settings: MappingSettings
	logDebug: (...args: unknown[]) => void = () => { }

	commands = [
		{ id: 'next-note', name: 'Create next note', callback: () => {this.nextNote()}, key: "N" },
		{ id: 'next-note-left', name: 'Create note left', callback: () => {this.nextNote()}, key: "ArrowLeft" },
		{ id: 'next-note-right', name: 'Create note right', callback: () => {this.nextNote()}, key: "ArrowRight" },
		{ id: 'next-note-up', name: 'Create note up', callback: () => {this.nextNote()}, key: "ArrowUp" },
		{ id: 'next-note-down', name: 'Create note down', callback: () => {this.nextNote()}, key: "ArrowDown" },
		{ id: 'next-note-sibling', name: 'Create note sibling', callback: () => {this.nextNote()}, key: "Enter" },
		{ id: 'generate-note', name: 'Generate AI note', callback: () => {this.generateNote()}, key: "G" }
	];

	async onload() {
		await this.loadSettings()

		this.logDebug = this.settings.debug
			? (message?: unknown, ...optionalParams: unknown[]) => console.debug('Chat Stream: ' + message, ...optionalParams)
			: () => { }

		this.addSettingTab(new SettingsTab(this.app, this))

		for (const command of this.commands) {
			this.addCommand({
				id: command.id,
				name: command.name,
				callback: command.callback,
				hotkeys: [
					{
						modifiers: ['Alt', 'Shift'],
						key: command.key,
					},
				],
			})
		}

	}

	onunload() {
		this.unloaded = true
	}

	async nextNote() {
		if (this.unloaded) return

		this.logDebug("Creating user note")

		const canvas = this.getActiveCanvas()
		if (!canvas) {
			this.logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values()) as CanvasNode[]
		const node = values[0]

		if (node) {
			const created = createNode(canvas, node, { text: '', size: { height: emptyNoteHeight } })
			canvas.selectOnly(created, true /* startEditing */)

			// startEditing() doesn't work if called immediately
			await canvas.requestSave()
			await sleep(0)

			created.startEditing()
		}
	}

	async generateNote() {
		if (this.unloaded) return

		if (!this.canCallAI()) return

		this.logDebug("Creating AI note")

		const canvas = this.getActiveCanvas()
		if (!canvas) {
			this.logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			// Last typed characters might not be applied to note yet
			await canvas.requestSave()
			await sleep(200)

			const settings = this.settings
			const messages = await buildMessages(node, canvas, settings, this.logDebug)
			if (!messages.length) return

			this.logDebug('Messages for chat API', messages)

			const created = createNode(canvas, node,
				{
					text: `Calling GPT (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: assistantColor,
					chat_role: 'assistant'
				})

			new Notice(`Sending ${messages.length} notes to GPT`)

			try {
				const generated = await getChatGPTCompletion(
					settings.apiKey,
					settings.apiModel,
					messages,
					{
						max_tokens: settings.maxResponseTokens || undefined,
					}
				)

				if (generated == null) {
					new Notice(`Empty or unreadable response from GPT`)
					canvas.removeNode(created)
					return
				}

				// Remove the placeholder node
				canvas.removeNode(created);

				// Split the response into nodes
				const nodesData = await markdownToMindMap(
					generated
				);

				const canvasNewNodes: CanvasNode[] = [];
				// Initialize a variable to keep track of the y position
				let yPosition = 0;

				// Add the nodes to the canvas
				for (const newNode of nodesData) {
					const parentNode = newNode.parentId ? canvasNewNodes[newNode.parentId] : node

					const height = calcHeight({
						text: newNode.content,
						parentHeight: parentNode.height,
					});

					const createdNode = createNode(
						canvas,
						parentNode,
						{
							text: newNode.content,
							size: { height: height },
							pos: { x: node.x, y: yPosition },
						},
						{
							color: assistantColor,
							chat_role: "assistant",
						}
					)

					canvasNewNodes.push(createdNode)

					createdNode.moveAndResize({
						height,
						width: createdNode.width,
						x: createdNode.x,
						y: createdNode.y,
					});
				}

				const selectedNoteId =
					canvas.selection?.size === 1
						? Array.from(canvas.selection.values())?.[0]?.id
						: undefined;

				if (selectedNoteId === node?.id || selectedNoteId == null) {
					// If the user has not changed selection, select the last created node
					canvas.selectOnly(canvasNewNodes[canvasNewNodes.length - 1], false /* startEditing */);
				}
			} catch (error) {
				new Notice(`Error calling GPT: ${error.message || error}`)
				canvas.removeNode(created)
			}

			await canvas.requestSave()
		}
	}

	getActiveCanvas() {
		const maybeCanvasView = app.workspace.getActiveViewOfType(ItemView) as CanvasView | null
		return maybeCanvasView ? maybeCanvasView['canvas'] : null
	}

	canCallAI() {
		if (!this.settings.apiKey) {
			new Notice('Please set your OpenAI API key in the plugin settings')
			return false
		}

		return true
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		)
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}

async function buildMessages(
	node: CanvasNode,
	canvas: Canvas,
	settings: MappingSettings,
	logDebug: (...args: unknown[]) => void
) {
	// Unique Map to avoid duplicate messages
	const uniqueMessages = new Map();

	const visit = async (node: CanvasNode, depth: number) => {
		if (settings.maxDepth && depth > settings.maxDepth) return;

		const nodeData = node.getData();
		let nodeText = (await getNodeText(node)) || "";

		const parents = canvas
			.getEdgesForNode(node)
			.filter((edge) => edge.to.node.id === node.id)
			.map((edge) => edge.from.node);

		if (nodeText.trim()) {
			let role: openai.ChatCompletionRequestMessageRoleEnum =
				nodeData.chat_role === "assistant" ? "assistant" : "user";

			if (parents.length === 0 && nodeText.startsWith("SYSTEM PROMPT")) {
				nodeText = nodeText.slice("SYSTEM PROMPT".length).trim();
				role = "system";
			}

			// Unique key for each message based on content and role
			const uniqueKey = `${nodeText}${role}`;

			if (!uniqueMessages.has(uniqueKey)) {
				uniqueMessages.set(uniqueKey, {
					content: { content: nodeText, role },
					depth,
				});
			}
		}

		// Iterate all parent nodes concurrently
		await Promise.all(parents.map((parent) => visit(parent, depth + 1)));
	};

	await visit(node, 0);

	if (!uniqueMessages.size) return [];

	// Converts uniqueMessages values to an array, sort and map them in a single operation
	// Define Message type
	type Message = {
		depth: number;
		content: { role: string; content: string }[];
		role?: string;
	};

	const messages: any[] = Array.from(uniqueMessages.values())
		.sort((a: Message, b: Message) => b.depth - a.depth)
		.map((message: Message) => message.content);

	// If totalLength >= lengthLimit, truncate messages
	const processedMessages = truncateMessages(
		messages,
		settings.maxInputCharacters ?? DEFAULT_SETTINGS.maxInputCharacters,
		logDebug
	);

	if (processedMessages[0]?.role !== "system") {
		const systemMessage = {
			content: settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
			role: "system",
		};

		// adding system message at the start of array
		processedMessages.unshift(systemMessage);
	}

	return messages;
}


async function getNodeText(node: CanvasNode) {
	const nodeData = node.getData()
	switch (nodeData.type) {
		case 'text':
			return nodeData.text
		case 'file':
			return readFile(nodeData.file)
	}
}

async function readFile(path: string) {
	const file = this.app.vault.getAbstractFileByPath(path)
	if (file instanceof TFile) {
		const body = await app.vault.read(file)
		return `## ${file.basename}\n${body}`
	}
}

/**
 * Choose height for generated note based on text length and parent height.
 * For notes beyond a few lines, the note will have scroll bar.
 * Not a precise science, just something that is not surprising.
 */
const calcHeight = (options: { parentHeight: number, text: string }) => {
	const calcTextHeight = Math.round(textPaddingHeight + pxPerLine * options.text.length / (minWidth / pxPerChar))
	return Math.max(options.parentHeight, calcTextHeight)
}

/**
 * Create new node as descendant from the parent node.
 * Align and offset relative to siblings.
 */
const createNode = (
	canvas: Canvas,
	parentNode: CanvasNode,
	nodeOptions: CreateNodeOptions,
	nodeData?: Partial<AllCanvasNodeData>
) => {
	if (!canvas) {
		throw new Error('Invalid arguments')
	}

	const { text } = nodeOptions
	const width = nodeOptions?.size?.width || Math.max(minWidth, parentNode?.width)
	const height = nodeOptions?.size?.height
		|| Math.max(minHeight, (parentNode && calcHeight({ text, parentHeight: parentNode.height })))

	const siblings = parent && canvas.getEdgesForNode(parentNode)
		.filter(n => n.from.node.id == parentNode.id)
		.map(e => e.to.node)
	const siblingsRight = siblings && siblings.reduce((right, sib) => Math.max(right, sib.x + sib.width), 0)
	const priorSibling = siblings[siblings.length - 1]

	// Position left at right of prior sibling, otherwise aligned with parent
	const x = siblingsRight ? siblingsRight + newNoteMargin : parentNode.x

	// Position top at prior sibling top, otherwise offset below parent
	const y = (priorSibling
		? priorSibling.y
		: (parentNode.y + parentNode.height + newNoteMargin))
		// Using position=left, y value is treated as vertical center
		+ height * 0.5

	const newNode = canvas.createTextNode(
		{
			pos: { x, y },
			position: 'left',
			size: { height, width },
			text,
			focus: false
		}
	)

	if (nodeData) {
		newNode.setData(nodeData)
	}

	canvas.deselectAll()
	canvas.addNode(newNode)

	addEdge(canvas, randomHexString(16), {
		fromOrTo: "from",
		side: "bottom",
		node: parentNode,
	}, {
		fromOrTo: "to",
		side: "top",
		node: newNode,
	})

	return newNode
}
/**
 * Truncating Messages when maxTextLimit is reached
 */

const truncateMessages = (
	messages: any[],
	maxLimit: number,
	logDebug: (arg0: string) => void
) => {
	let totalLength = messages.reduce(
		(accum, current) => accum + current.content.length,
		0
	);
	let removedMessages = 0;

	// Continue to remove older messages while total length exceeds the max limit
	while (totalLength > maxLimit) {
		removedMessages += 1;
		const removedMessage = messages.shift();
		logDebug(`Removing message due to text limit: ${removedMessage.content}`);
		totalLength -= removedMessage.content.length;
	}

	if (removedMessages > 0) {
		new Notice(`Too many messages: ${removedMessages} card(s) were removed`);
	}

	return messages;
};
