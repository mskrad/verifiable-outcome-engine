declare module "bn.js" {
  export default class BN {
    constructor(value: string | number | bigint | number[] | Uint8Array | Buffer);
    toString(base?: number): string;
  }
}
