declare module '@strudel/core' {
  export function repl(options: {
    defaultOutput?: any;
    onSchedulerError?: (e: Error) => void;
    onEvalError?: (e: Error) => void;
    getTime?: () => number;
    drawTime?: [number, number];
    onDraw?: (haps: any[], time: number) => void;
    beforeEval?: () => void;
    afterEval?: (data: any) => void;
  }): {
    evaluate: (code: string) => Promise<void>;
    stop: () => void;
    hush: () => void;
    scheduler: any;
  };
  export function evalScope(...moduleImports: Promise<any>[]): Promise<void>;
  export function stack(...patterns: any[]): any;
  export function note(input: any): any;
  export function sound(input: any): any;
  export function s(input: any): any;
  export function n(input: any): any;
  export const controls: any;
  export const Pattern: any;
}

declare module '@strudel/webaudio' {
  export function initAudio(): Promise<void>;
  export function initAudioOnFirstClick(): Promise<void>;
  export function getAudioContext(): AudioContext;
  export function getDefaultAudioContext(): AudioContext;
  export function samples(input: string | object, base?: string): Promise<void>;
  export function registerSynthSounds(): Promise<void> | void;
  export function registerZZFXSounds(): Promise<void> | void;
  export const webaudioOutput: any;
  export const soundMap: any;
}

declare module '@strudel/mini' {
  export function mini(input: string): any;
}
