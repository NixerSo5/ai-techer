export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  summary?: string;
  children: OutlineNode[];
}

export type EdgeType = 'contains' | 'prerequisite' | 'related';

export interface GraphNode {
  id: string;
  parentId: string | null;
  title: string;
  level: number;
  summary: string | null;
  content: string | null;
  sourceRef: string | null;
  sortOrder: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
}

export interface PathStep {
  nodeId: string;
  title: string;
  objective: string;
  estimatedMinutes: number;
  acceptance: string;
}
