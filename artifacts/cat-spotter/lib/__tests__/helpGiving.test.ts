import { describe, expect, it } from 'vitest';
import { givingState } from '../helpGiving';

const open = { donateUrl: 'https://donate.example/give' };

describe('givingState (spec §3.6)', () => {
  it('A: online, a campaign arrived, valid https donateUrl', () => {
    expect(
      givingState({ online: true, campaign: open, campaignStatus: 'success', donateHost: 'syroscats.com' }),
    ).toBe('campaign');
    expect(givingState({ online: true, campaign: open, campaignStatus: 'success', donateHost: null })).toBe(
      'campaign',
    );
  });

  it('loading is never A: B with a saved host, C without (no spinner state)', () => {
    expect(givingState({ online: true, campaign: undefined, campaignStatus: 'pending', donateHost: 'syroscats.com' })).toBe('link');
    expect(givingState({ online: true, campaign: undefined, campaignStatus: 'pending', donateHost: null })).toBe('none');
  });

  it('an error (including the 503 campaign_misconfigured) is B or C', () => {
    expect(givingState({ online: true, campaign: undefined, campaignStatus: 'error', donateHost: 'syroscats.com' })).toBe('link');
    expect(givingState({ online: true, campaign: undefined, campaignStatus: 'error', donateHost: null })).toBe('none');
  });

  it('offline is never A, even with a campaign in the cache', () => {
    expect(givingState({ online: false, campaign: open, campaignStatus: 'success', donateHost: 'syroscats.com' })).toBe('link');
    expect(givingState({ online: false, campaign: open, campaignStatus: 'success', donateHost: null })).toBe('none');
  });

  it.each(['', 'http://insecure.example/x', 'javascript:alert(1)', 'not a url', null, undefined])(
    'a campaign whose donateUrl is %j is not A',
    (donateUrl) => {
      expect(
        givingState({ online: true, campaign: { donateUrl }, campaignStatus: 'success', donateHost: 'syroscats.com' }),
      ).toBe('link');
      expect(
        givingState({ online: true, campaign: { donateUrl }, campaignStatus: 'success', donateHost: null }),
      ).toBe('none');
    },
  );

  it('a blank saved host counts as none', () => {
    expect(givingState({ online: true, campaign: undefined, campaignStatus: 'error', donateHost: '  ' })).toBe('none');
  });
});
