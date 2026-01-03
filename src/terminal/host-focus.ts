type HostFocusState = boolean | null;

let hostFocusState: HostFocusState = null;

export function setHostFocusState(state: HostFocusState): void {
  hostFocusState = state;
}

export function getHostFocusState(): HostFocusState {
  return hostFocusState;
}
