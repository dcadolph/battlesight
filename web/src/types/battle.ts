export interface Side {
  name: string;
  commander: string;
  strength: string;
  casualties: string;
}

export interface Reference {
  type: string;
  title: string;
  author?: string;
  year?: number;
  url?: string;
  note?: string;
}

export interface Battle {
  id: string;
  name: string;
  year: number;
  date: string;
  lat: number;
  lng: number;
  era: string;
  war: string;
  battleType: string;
  sides: Side[];
  victor: string;
  summary: string;
  significance: string;
  references?: Reference[];
}

export const ERA_COLORS: Record<string, string> = {
  'ancient': '#f59e0b',
  'medieval': '#ef4444',
  'early-modern': '#8b5cf6',
  'napoleonic': '#3b82f6',
  'industrial': '#6366f1',
  'world-war-1': '#ec4899',
  'world-war-2': '#f43f5e',
  'modern': '#10b981',
};

export const ERA_LABELS: Record<string, string> = {
  'ancient': 'Ancient',
  'medieval': 'Medieval',
  'early-modern': 'Early Modern',
  'napoleonic': 'Napoleonic',
  'industrial': 'Industrial Age',
  'world-war-1': 'World War I',
  'world-war-2': 'World War II',
  'modern': 'Modern',
};
