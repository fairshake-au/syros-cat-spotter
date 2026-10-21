import { safeDonateUrl } from './campaignDates';

/**
 * Which giving section the Help & info page shows (spec §3.6).
 *
 *  - 'campaign' (state A): online, the campaign request succeeded, and it has
 *    a valid https donate address. Only then does the in-app campaign card show.
 *  - 'link' (state B): not A, and the app's saved settings carry a donation
 *    page host. A small card that opens the donations page in the browser.
 *  - 'none' (state C): neither. The section isn't shown.
 *
 * "Not A" covers every case where the campaign isn't usable: offline, still
 * loading, any error (including the 503 campaign_misconfigured), or a campaign
 * with no valid address. So the page never shows a spinner or an error here,
 * and swaps to A only when a usable campaign arrives.
 */
export type GivingState = 'campaign' | 'link' | 'none';

export type CampaignRequestStatus = 'pending' | 'error' | 'success';

export function givingState(input: {
  online: boolean;
  campaign: { donateUrl?: string | null } | null | undefined;
  campaignStatus: CampaignRequestStatus;
  donateHost: string | null | undefined;
}): GivingState {
  const { online, campaign, campaignStatus, donateHost } = input;
  if (online && campaignStatus === 'success' && !!campaign && safeDonateUrl(campaign.donateUrl) !== null) {
    return 'campaign';
  }
  return typeof donateHost === 'string' && donateHost.trim() !== '' ? 'link' : 'none';
}
