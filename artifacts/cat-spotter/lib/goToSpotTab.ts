/**
 * SYC-508: from a screen stacked over the tabs (Notifications, the review
 * screen), go back to the Spot tab without leaving a second copy of the tabs
 * behind, so Back keeps working normally.
 */
export function goToSpotTab(router: { dismissTo: (href: '/spot') => void }): void {
  router.dismissTo('/spot');
}
