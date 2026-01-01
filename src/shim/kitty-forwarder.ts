export type KittyTransmitForwarder = (ptyId: string, sequence: string) => void;
export type KittyUpdateForwarder = (ptyId: string) => void;

let kittyTransmitForwarder: KittyTransmitForwarder | null = null;
let kittyUpdateForwarder: KittyUpdateForwarder | null = null;

export function setKittyTransmitForwarder(forwarder: KittyTransmitForwarder | null): void {
  kittyTransmitForwarder = forwarder;
}

export function getKittyTransmitForwarder(): KittyTransmitForwarder | null {
  return kittyTransmitForwarder;
}

export function setKittyUpdateForwarder(forwarder: KittyUpdateForwarder | null): void {
  kittyUpdateForwarder = forwarder;
}

export function getKittyUpdateForwarder(): KittyUpdateForwarder | null {
  return kittyUpdateForwarder;
}
