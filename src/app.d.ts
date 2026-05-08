// SvelteKit 기본 type 선언 + 외부 모듈의 누락된 타입 보충

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  namespace App {}
}

// cytoscape-fcose는 자체 타입 정의 미제공
declare module "cytoscape-fcose";

export {};
