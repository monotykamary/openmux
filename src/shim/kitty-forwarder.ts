export type KittyTransmitForwarder = (ptyId: string, sequence: string) => void;

let kittyTransmitForwarder: KittyTransmitForwarder | null = null;

export function setKittyTransmitForwarder(forwarder: KittyTransmitForwarder | null): void {
  kittyTransmitForwarder = forwarder;
}

export function getKittyTransmitForwarder(): KittyTransmitForwarder | null {
  return kittyTransmitForwarder;
}
