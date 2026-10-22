/**
 * Real campaign data for the C2 console (integration ticket 12). Reads and writes go through the engagement's campaign
 * routes. An accepted write refreshes the engagement's campaign list; a refused write reaches the caller as its error,
 * and the caller owns the state it shows for that error.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCampaign, fetchCampaignCapabilities, fetchCampaigns, reconcileCampaignJob, runCampaignJob } from './remote'

type CampaignDraft = Parameters<typeof createCampaign>[1]

interface WriteOutcome {
  onSuccess: () => void
  onError: (error: unknown) => void
}

export function useRealCampaigns(engagementId: string) {
  return useQuery({ queryKey: ['real', 'campaigns', engagementId], queryFn: () => fetchCampaigns(engagementId), retry: false })
}

export function useRealCampaignCapabilities(engagementId: string) {
  return useQuery({ queryKey: ['real', 'campaign-capabilities', engagementId], queryFn: () => fetchCampaignCapabilities(engagementId), retry: false })
}

function useRefreshCampaigns(engagementId: string): () => void {
  const client = useQueryClient()
  return () => { void client.invalidateQueries({ queryKey: ['real', 'campaigns', engagementId] }) }
}

/** `build` assembles the draft at submit time; it may throw to refuse locally, before any request is sent. */
export function useCreateRealCampaign(engagementId: string, options: WriteOutcome & { build: () => CampaignDraft }) {
  const refresh = useRefreshCampaigns(engagementId)
  return useMutation({
    mutationFn: () => createCampaign(engagementId, options.build()),
    onSuccess: () => { options.onSuccess(); refresh() },
    onError: options.onError,
  })
}

export function useRunRealCampaignJob(engagementId: string, options: WriteOutcome) {
  const refresh = useRefreshCampaigns(engagementId)
  return useMutation({
    mutationFn: (input: { campaignId: string; kind: 'generate' | 'deploy'; version: number }) =>
      runCampaignJob(engagementId, input.campaignId, input.kind, { requestId: crypto.randomUUID(), version: input.version }),
    onSuccess: () => { options.onSuccess(); refresh() },
    onError: options.onError,
  })
}

export function useReconcileRealCampaignJob(engagementId: string, options: WriteOutcome) {
  const refresh = useRefreshCampaigns(engagementId)
  return useMutation({
    mutationFn: (input: { campaignId: string; jobId: string }) => reconcileCampaignJob(engagementId, input.campaignId, input.jobId),
    onSuccess: () => { options.onSuccess(); refresh() },
    onError: options.onError,
  })
}
