export type ParsedTurn = {
  role: string;
  content: string;
};

export type ParsedConversation = {
  title: string | null;
  turns: ParsedTurn[];
  markdown: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const rec = asRecord(part);
        if (!rec) return '';
        if (typeof rec.text === 'string') return rec.text;
        if (typeof rec.content === 'string') return rec.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const rec = asRecord(content);
  if (!rec) return '';
  if (Array.isArray(rec.parts)) return extractTextContent(rec.parts);
  if (typeof rec.text === 'string') return rec.text.trim();
  if (typeof rec.content === 'string') return rec.content.trim();
  return '';
}

function turnsToMarkdown(title: string | null, turns: ParsedTurn[]): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`, '');
  }
  for (const turn of turns) {
    const role = turn.role.trim() || 'unknown';
    const heading = role.charAt(0).toUpperCase() + role.slice(1);
    lines.push(`## ${heading}`, '', turn.content, '');
  }
  return lines.join('\n').replace(/\s+$/u, '').trim();
}

function normalizeRole(role: unknown): string {
  if (typeof role !== 'string' || !role.trim()) return 'unknown';
  return role.trim().toLowerCase();
}

function parseMessageList(messages: unknown[]): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  for (const item of messages) {
    const rec = asRecord(item);
    if (!rec) continue;
    const role =
      normalizeRole(rec.role) !== 'unknown'
        ? normalizeRole(rec.role)
        : normalizeRole(asRecord(rec.author)?.role);
    const content = extractTextContent(rec.content ?? rec.message ?? rec.text);
    if (!content) continue;
    if (role === 'system' || role === 'tool') continue;
    turns.push({ role, content });
  }
  return turns;
}

/** ChatGPT data export conversation object (`mapping` tree) or message array. */
export function parseChatgptExport(raw: string): ParsedConversation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ChatGPT export must be valid JSON');
  }

  const conversations = Array.isArray(parsed)
    ? parsed
    : asRecord(parsed)?.conversations && Array.isArray(asRecord(parsed)?.conversations)
      ? (asRecord(parsed)!.conversations as unknown[])
      : [parsed];

  const allTurns: ParsedTurn[] = [];
  let title: string | null = null;

  for (const convo of conversations) {
    const rec = asRecord(convo);
    if (!rec) continue;
    if (!title) title = stringField(rec, 'title');

    if (Array.isArray(rec.messages)) {
      allTurns.push(...parseMessageList(rec.messages));
      continue;
    }

    const mapping = asRecord(rec.mapping);
    if (!mapping) continue;

    type Node = {
      id: string;
      parent: string | null;
      children: string[];
      message: Record<string, unknown> | null;
    };

    const nodes = new Map<string, Node>();
    for (const [id, value] of Object.entries(mapping)) {
      const node = asRecord(value);
      if (!node) continue;
      const children = Array.isArray(node.children)
        ? node.children.filter((c): c is string => typeof c === 'string')
        : [];
      nodes.set(id, {
        id,
        parent: typeof node.parent === 'string' ? node.parent : null,
        children,
        message: asRecord(node.message),
      });
    }

    let rootId: string | null = null;
    for (const node of nodes.values()) {
      if (node.parent == null || !nodes.has(node.parent)) {
        rootId = node.id;
        break;
      }
    }
    if (!rootId) continue;

    const ordered: Node[] = [];
    const walk = (id: string) => {
      const node = nodes.get(id);
      if (!node) return;
      ordered.push(node);
      for (const childId of node.children) walk(childId);
    };
    walk(rootId);

    for (const node of ordered) {
      if (!node.message) continue;
      const author = asRecord(node.message.author);
      const role = normalizeRole(author?.role);
      if (role === 'system' || role === 'tool') continue;
      const content = extractTextContent(node.message.content);
      if (!content) continue;
      allTurns.push({ role, content });
    }
  }

  if (allTurns.length === 0) {
    throw new Error('ChatGPT export contained no user/assistant messages');
  }

  return {
    title,
    turns: allTurns,
    markdown: turnsToMarkdown(title, allTurns),
  };
}

/** Open WebUI chat export (messages array, or nested chat/history). */
export function parseOpenWebuiExport(raw: string): ParsedConversation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Open WebUI export must be valid JSON');
  }

  const root = asRecord(parsed);
  const candidates: unknown[] = [];

  if (Array.isArray(parsed)) {
    candidates.push(...parsed);
  } else if (root) {
    candidates.push(root);
    const chat = asRecord(root.chat);
    if (chat) candidates.push(chat);
    const history = asRecord(root.history) ?? (chat ? asRecord(chat.history) : null);
    if (history?.messages) candidates.push(history);
  }

  let title: string | null = null;
  let turns: ParsedTurn[] = [];

  for (const candidate of candidates) {
    const rec = asRecord(candidate);
    if (!rec) continue;
    if (!title) title = stringField(rec, 'title');

    if (Array.isArray(rec.messages)) {
      turns = parseMessageList(rec.messages);
      if (turns.length > 0) break;
    } else if (asRecord(rec.messages)) {
      // Open WebUI sometimes stores messages as an id→message map
      turns = parseMessageList(Object.values(asRecord(rec.messages)!));
      if (turns.length > 0) break;
    }

    const history = asRecord(rec.history);
    if (history && Array.isArray(history.messages)) {
      turns = parseMessageList(history.messages);
      if (turns.length > 0) break;
    } else if (history && asRecord(history.messages)) {
      turns = parseMessageList(Object.values(asRecord(history.messages)!));
      if (turns.length > 0) break;
    }
  }

  if (turns.length === 0) {
    throw new Error('Open WebUI export contained no user/assistant messages');
  }

  return {
    title,
    turns,
    markdown: turnsToMarkdown(title, turns),
  };
}

/**
 * Generic JSON conversation: `{ title?, messages|turns: [{ role, content }] }`
 * or a bare message array.
 */
export function parseGenericJsonExport(raw: string): ParsedConversation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Generic JSON import must be valid JSON');
  }

  let title: string | null = null;
  let turns: ParsedTurn[] = [];

  if (Array.isArray(parsed)) {
    turns = parseMessageList(parsed);
  } else {
    const root = asRecord(parsed);
    if (!root) {
      throw new Error('Generic JSON import must be an object or message array');
    }
    title = stringField(root, 'title');
    if (Array.isArray(root.messages)) {
      turns = parseMessageList(root.messages);
    } else if (Array.isArray(root.turns)) {
      turns = parseMessageList(root.turns);
    } else if (Array.isArray(root.conversation)) {
      turns = parseMessageList(root.conversation);
    }
  }

  if (turns.length === 0) {
    throw new Error(
      'Generic JSON import needs messages/turns with role and content',
    );
  }

  return {
    title,
    turns,
    markdown: turnsToMarkdown(title, turns),
  };
}

export function parseStructuredConversation(
  format: 'chatgpt_export' | 'open_webui' | 'generic_json',
  raw: string,
): ParsedConversation {
  switch (format) {
    case 'chatgpt_export':
      return parseChatgptExport(raw);
    case 'open_webui':
      return parseOpenWebuiExport(raw);
    case 'generic_json':
      return parseGenericJsonExport(raw);
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported format: ${_exhaustive}`);
    }
  }
}

export function isStructuredContentFormat(
  format: string,
): format is 'chatgpt_export' | 'open_webui' | 'generic_json' {
  return (
    format === 'chatgpt_export' ||
    format === 'open_webui' ||
    format === 'generic_json'
  );
}
