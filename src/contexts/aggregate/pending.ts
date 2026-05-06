/**
 * Pending PTY insertion operations for Aggregate View.
 */

import type { AggregateViewState, PendingPaneCreation } from './types';
import { buildSessionPaneOrderFromAggregateState } from './pane-order';

type PendingInsertionCollectionState = Pick<AggregateViewState, 'pendingPaneCreations'>;
type PendingInsertionOrderState = Pick<
  AggregateViewState,
  'allPtys' | 'sessionPaneOrderIndex' | 'pendingPaneCreations'
>;

export function setPendingPaneCreations(
  state: PendingInsertionCollectionState,
  insertions: PendingPaneCreation[]
): void {
  state.pendingPaneCreations = insertions;
}

export function upsertPendingPaneCreation(
  state: PendingInsertionCollectionState,
  insertion: PendingPaneCreation
): void {
  const nextInsertions = state.pendingPaneCreations.filter(
    (candidate) => candidate.id !== insertion.id
  );
  nextInsertions.push(insertion);
  setPendingPaneCreations(state, nextInsertions);
}

export function removePendingPaneCreations(
  state: PendingInsertionCollectionState,
  predicate: (insertion: PendingPaneCreation) => boolean
): void {
  setPendingPaneCreations(
    state,
    state.pendingPaneCreations.filter((insertion) => !predicate(insertion))
  );
}

function getAppendedPaneOrder(paneOrder: Map<string, number>): number {
  return [...paneOrder.values()].reduce((maxOrder, order) => Math.max(maxOrder, order), -1) + 1;
}

export function getNextPendingPaneCreationOrder(
  state: PendingInsertionOrderState,
  params: { sessionId: string; insertAfterPaneId: string | null }
): number {
  const paneOrder = buildSessionPaneOrderFromAggregateState(state, params.sessionId);
  const existingPendingOrders = state.pendingPaneCreations
    .filter(
      (insertion) =>
        insertion.sessionId === params.sessionId &&
        insertion.insertAfterPaneId === params.insertAfterPaneId
    )
    .map((insertion) => insertion.sortOrderHint)
    .filter((order): order is number => order !== undefined);

  if (!params.insertAfterPaneId) {
    const appendedOrder = getAppendedPaneOrder(paneOrder);
    if (existingPendingOrders.length === 0) {
      return appendedOrder;
    }
    return Math.max(appendedOrder - 1, ...existingPendingOrders) + 1;
  }

  const insertAfterOrder = paneOrder.get(params.insertAfterPaneId);
  if (insertAfterOrder === undefined) {
    const appendedOrder = getAppendedPaneOrder(paneOrder);
    if (existingPendingOrders.length === 0) {
      return appendedOrder;
    }
    return Math.max(appendedOrder - 1, ...existingPendingOrders) + 1;
  }

  let upperOrder: number | undefined;
  for (const order of paneOrder.values()) {
    if (order <= insertAfterOrder) {
      continue;
    }
    if (upperOrder === undefined || order < upperOrder) {
      upperOrder = order;
    }
  }

  if (upperOrder === undefined) {
    const boundedPendingOrders = existingPendingOrders.filter((order) => order > insertAfterOrder);
    const lowerOrder =
      boundedPendingOrders.length > 0 ? Math.max(...boundedPendingOrders) : insertAfterOrder;
    return Math.floor(lowerOrder) + 1;
  }

  // Repeated midpoint insertion collapses to the upper bound after ~50 pending panes,
  // which makes later creations tie with the next row and fall to the bottom of the group.
  // Use a monotonic n/(n+1) distribution within the current gap instead so large bursts of
  // aggregate pane creation keep distinct sort orders while preserving adjacency.
  const boundedPendingCount = existingPendingOrders.filter(
    (order) => order > insertAfterOrder && order < upperOrder
  ).length;
  return (
    insertAfterOrder +
    ((upperOrder - insertAfterOrder) * (boundedPendingCount + 1)) / (boundedPendingCount + 2)
  );
}

export function findPendingPaneCreationForLifecycle(
  state: PendingInsertionCollectionState,
  params: { ptyId?: string | null; sessionId?: string | null; paneId?: string | null }
): PendingPaneCreation | null {
  if (params.ptyId) {
    const matchingPtyInsertion = state.pendingPaneCreations.find(
      (insertion) => insertion.pendingPtyId === params.ptyId
    );
    if (matchingPtyInsertion) {
      return matchingPtyInsertion;
    }
  }

  const sessionInsertions = state.pendingPaneCreations.filter(
    (insertion) => !params.sessionId || insertion.sessionId === params.sessionId
  );

  if (params.paneId) {
    const matchingPaneInsertion = sessionInsertions.find(
      (insertion) => insertion.pendingPaneId === params.paneId
    );
    if (matchingPaneInsertion) {
      return matchingPaneInsertion;
    }
  }

  // When the PTY lifecycle event fires before createPaneWithPTY's onCreated
  // callback sets pendingPtyId/pendingPaneId, we can still match unclaimed
  // insertions for the same session that haven't been assigned a PTY yet.
  // This prevents the pane from being sorted to the bottom due to a missing
  // sortOrderHint.
  if (params.ptyId && params.sessionId) {
    const unclaimedInsertions = sessionInsertions.filter(
      (insertion) => insertion.pendingPtyId === null
    );

    if (unclaimedInsertions.length === 1) {
      return unclaimedInsertions[0] ?? null;
    }
  }

  return null;
}
