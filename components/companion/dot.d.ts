// Types for dot.js, the designer's three.js character ("Dot", soft, shaggy or smooth fur).
export declare const MOODS: string[];
export declare const COLORS: Record<string, string>;
export type DotFur = "soft" | "shaggy" | "smooth";
export interface DotOptions {
  mood?: string;
  color?: string;
  fur?: DotFur;
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
  furs: string[];
  getFur(): string;
  setFur(fur: DotFur): boolean;
  setOptions(options: Partial<DotOptions>): void;
  destroy(): void;
}
export declare function createCompanion(container: HTMLElement, options?: DotOptions): DotHandle;
