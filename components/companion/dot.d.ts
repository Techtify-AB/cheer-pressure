// Types for dot.js, the designer's three.js character ("Dot", soft fur).
export declare const MOODS: string[];
export declare const COLORS: Record<string, string>;
export interface DotOptions {
  mood?: string;
  color?: string;
  rings?: boolean;
  effects?: boolean;
  zoom?: number;
}
export interface DotHandle {
  moods: string[];
  colors: string[];
  getMood(): string;
  getColor(): string;
  setMood(mood: string): boolean;
  setColor(color: string): void;
  setOptions(options: Partial<DotOptions>): void;
  destroy(): void;
}
export declare function createCompanion(container: HTMLElement, options?: DotOptions): DotHandle;
