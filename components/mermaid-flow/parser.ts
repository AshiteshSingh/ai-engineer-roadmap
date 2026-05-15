/* ── Mermaid → AST parser ─��────────────────────────────────── */

// ── Shared shapes ─────────────────────────────────────────────

export type NodeShape = "rect" | "stadium" | "circle" | "diamond";

// ── Flowchart AST ────────────────────────────────��────────────

export interface FlowNodeDef {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface FlowEdgeDef {
  source: string;
  target: string;
  label?: string;
  lineStyle: "solid" | "dotted" | "thick";
}

export interface SubgraphDef {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface FlowchartAST {
  type: "flowchart";
  direction: "TD" | "LR";
  nodes: Map<string, FlowNodeDef>;
  edges: FlowEdgeDef[];
  subgraphs: SubgraphDef[];
  styles: Map<string, Record<string, string>>;
}

// ── Sequence Diagram AST ─────────────���────────────────────────

export interface ParticipantDef {
  id: string;
  alias: string;
}

export interface MessageDef {
  from: string;
  to: string;
  text: string;
  lineStyle: "solid" | "dashed";
}

export interface SequenceDiagramAST {
  type: "sequence";
  participants: ParticipantDef[];
  messages: MessageDef[];
}

// ── ER Diagram AST ────────────────────────────────────────────

export interface EntityAttr {
  type: string;
  name: string;
  constraint?: string;
}

export interface EntityDef {
  name: string;
  attributes: EntityAttr[];
}

export interface RelationDef {
  from: string;
  to: string;
  label: string;
  cardinality: string;
}

export interface ERDiagramAST {
  type: "er";
  entities: EntityDef[];
  relations: RelationDef[];
}

// ── Union ─────────────────────────────────────────────────────

export type MermaidAST = FlowchartAST | SequenceDiagramAST | ERDiagramAST;

// ── Main entry point ───────────���──────────────────────────────

export function parseMermaid(source: string): MermaidAST | null {
  const lines = source
    .split("\n")
    .map((l) => l.replace(/%%.*$/, "").trimEnd()); // strip comments

  const first = lines.find((l) => l.trim().length > 0)?.trim() ?? "";

  if (/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/i.test(first)) {
    return parseFlowchart(lines);
  }
  if (/^sequenceDiagram/i.test(first)) {
    return parseSequence(lines);
  }
  if (/^erDiagram/i.test(first)) {
    return parseER(lines);
  }
  return null;
}

// ── Flowchart parser ────��─────────────────────────────────────

function humanizeId(id: string): string {
  return id.replace(/_/g, " ");
}

function parseNodeRef(raw: string): FlowNodeDef | null {
  const s = raw.trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  // Circle: id((label))
  m = s.match(/^([\w.-]+)\(\((.+?)\)\)$/);
  if (m) return { id: m[1], label: m[2].replace(/\\n/g, "\n"), shape: "circle" };

  // Diamond: id{label} or id{"label"}
  m = s.match(/^([\w.-]+)\{"?(.+?)"?\}$/);
  if (m) return { id: m[1], label: m[2].replace(/\\n/g, "\n"), shape: "diamond" };

  // Stadium: id(label) — but NOT ((
  m = s.match(/^([\w.-]+)\(([^(].*?)\)$/);
  if (m) return { id: m[1], label: m[2].replace(/\\n/g, "\n"), shape: "stadium" };

  // Rect quoted: id["label"]
  m = s.match(/^([\w.-]+)\["(.+?)"\]$/);
  if (m) return { id: m[1], label: m[2].replace(/\\n/g, "\n"), shape: "rect" };

  // Rect: id[label]
  m = s.match(/^([\w.-]+)\[(.+?)\]$/);
  if (m) return { id: m[1], label: m[2].replace(/\\n/g, "\n"), shape: "rect" };

  // Bare id
  m = s.match(/^([\w.-]+)$/);
  if (m) return { id: m[1], label: humanizeId(m[1]), shape: "rect" };

  return null;
}

function ensureNode(
  map: Map<string, FlowNodeDef>,
  def: FlowNodeDef,
): void {
  if (!map.has(def.id)) {
    map.set(def.id, def);
  }
}

// Arrow regex — captures arrow + optional |label|
const ARROW_RE = /(-->|-.->|==>|---)\s*(?:\|([^|]*)\|\s*)?/;

function parseFlowchart(lines: string[]): FlowchartAST {
  const first = lines.find((l) => l.trim().length > 0)!.trim();
  const dirMatch = first.match(/(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/i);
  const rawDir = dirMatch?.[1]?.toUpperCase() ?? "TD";
  const direction: "TD" | "LR" = rawDir === "TD" || rawDir === "TB" ? "TD" : "LR";

  const nodes = new Map<string, FlowNodeDef>();
  const edges: FlowEdgeDef[] = [];
  const subgraphs: SubgraphDef[] = [];
  const styles = new Map<string, Record<string, string>>();

  const sgStack: { id: string; label: string; nodeIds: string[] }[] = [];

  const addNode = (def: FlowNodeDef) => {
    ensureNode(nodes, def);
    if (sgStack.length > 0) {
      const top = sgStack[sgStack.length - 1];
      if (!top.nodeIds.includes(def.id)) top.nodeIds.push(def.id);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Skip the graph/flowchart declaration
    if (/^(graph|flowchart)\s+/i.test(line)) continue;

    // Subgraph start
    const sgMatch = line.match(
      /^subgraph\s+([^\s\["]+)(?:\["(.+?)"\])?(?:\s+(.+))?$/,
    );
    if (sgMatch) {
      const id = sgMatch[1];
      const label = sgMatch[2] || sgMatch[3] || id;
      sgStack.push({ id, label, nodeIds: [] });
      continue;
    }

    // Subgraph end
    if (/^end$/i.test(line)) {
      const sg = sgStack.pop();
      if (sg) subgraphs.push(sg);
      continue;
    }

    // Style directive
    const styleMatch = line.match(/^style\s+([\w.-]+)\s+(.+)$/);
    if (styleMatch) {
      const props: Record<string, string> = {};
      styleMatch[2].split(",").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon > 0) {
          props[part.substring(0, colon).trim()] = part.substring(colon + 1).trim();
        }
      });
      styles.set(styleMatch[1], props);
      continue;
    }

    // Try edge parse
    const arrowMatch = ARROW_RE.exec(line);
    if (arrowMatch && arrowMatch.index !== undefined) {
      const arrow = arrowMatch[1];
      const edgeLabel = arrowMatch[2]?.replace(/^"(.*)"$/, "$1").trim();
      const leftPart = line.substring(0, arrowMatch.index).trim();
      const rightPart = line
        .substring(arrowMatch.index + arrowMatch[0].length)
        .trim();

      const lineStyle: FlowEdgeDef["lineStyle"] =
        arrow === "-.->" ? "dotted" : arrow === "==>" ? "thick" : "solid";

      // Parse fan syntax (split by &)
      const sources = leftPart.split(/\s*&\s*/).map((s) => {
        const def = parseNodeRef(s);
        if (def) addNode(def);
        return def?.id;
      }).filter(Boolean) as string[];

      const targets = rightPart.split(/\s*&\s*/).map((s) => {
        const def = parseNodeRef(s);
        if (def) addNode(def);
        return def?.id;
      }).filter(Boolean) as string[];

      for (const src of sources) {
        for (const tgt of targets) {
          edges.push({
            source: src,
            target: tgt,
            label: edgeLabel || undefined,
            lineStyle,
          });
        }
      }
      continue;
    }

    // Standalone node definition
    const nodeDef = parseNodeRef(line);
    if (nodeDef) {
      addNode(nodeDef);
    }
  }

  return { type: "flowchart", direction, nodes, edges, subgraphs, styles };
}

// ── Sequence diagram parser ───────────────────────────────────

function parseSequence(lines: string[]): SequenceDiagramAST {
  const participants: ParticipantDef[] = [];
  const messages: MessageDef[] = [];
  const seenParticipants = new Set<string>();

  const ensureParticipant = (id: string) => {
    if (!seenParticipants.has(id)) {
      seenParticipants.add(id);
      participants.push({ id, alias: id });
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^sequenceDiagram/i.test(line)) continue;

    // participant X as Alias
    const pMatch = line.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?$/);
    if (pMatch) {
      const id = pMatch[1];
      const alias = pMatch[2]?.trim() || id;
      seenParticipants.add(id);
      participants.push({ id, alias });
      continue;
    }

    // Message: A->>B: text  or  A-->>B: text  (with optional +/-)
    const mMatch = line.match(
      /^(\S+?)\s*(->>|-->>)\+?\s*-?\s*(\S+?)\s*:\s*(.+)$/,
    );
    if (mMatch) {
      const from = mMatch[1];
      const arrow = mMatch[2];
      const to = mMatch[3];
      const text = mMatch[4].trim();

      ensureParticipant(from);
      ensureParticipant(to);

      messages.push({
        from,
        to,
        text,
        lineStyle: arrow === "-->>" ? "dashed" : "solid",
      });
    }
  }

  return { type: "sequence", participants, messages };
}

// ── ER diagram parser ───────────────��─────────────────────────

function parseER(lines: string[]): ERDiagramAST {
  const entities = new Map<string, EntityDef>();
  const relations: RelationDef[] = [];

  const ensureEntity = (name: string) => {
    if (!entities.has(name)) {
      entities.set(name, { name, attributes: [] });
    }
  };

  let currentEntity: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^erDiagram/i.test(line)) continue;

    // Entity block start: NAME {
    const blockStart = line.match(/^(\w+)\s*\{$/);
    if (blockStart) {
      currentEntity = blockStart[1];
      ensureEntity(currentEntity);
      continue;
    }

    // Entity block end
    if (line === "}" && currentEntity) {
      currentEntity = null;
      continue;
    }

    // Attribute line inside entity block
    if (currentEntity) {
      const attrMatch = line.match(/^(\S+)\s+(\S+)(?:\s+(PK|FK))?/);
      if (attrMatch) {
        entities.get(currentEntity)!.attributes.push({
          type: attrMatch[1],
          name: attrMatch[2],
          constraint: attrMatch[3],
        });
      }
      continue;
    }

    // Relation: TABLE_A ||--o{ TABLE_B : label
    const relMatch = line.match(
      /^(\w+)\s+(\S+)\s+(\w+)\s*:\s*(.+)$/,
    );
    if (relMatch) {
      ensureEntity(relMatch[1]);
      ensureEntity(relMatch[3]);
      relations.push({
        from: relMatch[1],
        to: relMatch[3],
        label: relMatch[4].trim(),
        cardinality: relMatch[2],
      });
    }
  }

  return { type: "er", entities: [...entities.values()], relations };
}
