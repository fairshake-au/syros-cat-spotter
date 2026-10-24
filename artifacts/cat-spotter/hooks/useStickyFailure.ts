import { useEffect, useState } from 'react';

/**
 * SYC-508 (review of #302, finding 1): "it failed and nothing has loaded",
 * held through a retry. react-query v5 resets a query that has never had
 * data back to pending (isError false) while it refetches, which would swap
 * "Couldn't load" for a page spinner and hide Try again's own busy state.
 * This stays true from the first failure until data arrives.
 */
export function useStickyFailure(isError: boolean, hasData: boolean): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (hasData) setFailed(false);
    else if (isError) setFailed(true);
  }, [isError, hasData]);
  return !hasData && (failed || isError);
}
